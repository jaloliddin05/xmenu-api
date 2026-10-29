import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Lang } from 'src/infra/http/request-helpers';
import { CustomerAuthException } from 'src/modules/auth/errors/customer-auth.exception';
import type { CustomerPrincipal } from 'src/modules/auth/decorators/customer-route.decorator';
import { BranchService } from 'src/modules/branch/services/branch.service';
import { toAddressView } from 'src/modules/customer/services/customer-address.service';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import { PaymentConfigService } from 'src/modules/payment/services/payment-config.service';
import { PaymentLinkService } from 'src/modules/payment/services/payment-link.service';
import { CreateOrderDto } from '../dto/create-order.dto';
import { computeTotals, deliveryZoneProblem, hashOrderRequest } from '../domain/order-money';
import { priceLines, PricingProduct } from '../domain/order-pricing';
import { ACTIVE_STATUSES, CUSTOMER_CANCELLABLE, OrderStatusName } from '../domain/order-state-machine';
import type { Tenant } from 'src/modules/tenant/tenant.service';
import { OrderSettingsService } from './order-settings.service';
import { InvalidTransitionError, OrderNotFoundError, OrderTransitionService } from './order-transition.service';
import { OrderWithItems, toOrderView } from './order-view';

export const ORDER_INCLUDE = {
  items: { include: { options: true } },
  branch: { select: { id: true, title: true, address: true } },
} satisfies Prisma.customer_orderInclude;

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,128}$/;

@Injectable()
export class OrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: OrderSettingsService,
    private readonly branches: BranchService,
    private readonly transitions: OrderTransitionService,
    private readonly payments: PaymentConfigService,
    private readonly links: PaymentLinkService,
  ) {}

  // ------------------------------------------------------------------ create

  /**
   * POST /orders. Tartib: takror so'rovmi? → mijoz → filial/ish vaqti → manzil/zona →
   * to'lov usuli → narxlash (bazadan) → summa/minimum → faol buyurtmalar chegarasi →
   * yozish (bitta tranzaksiya). Birinchi topilgan muammo darhol xato qaytaradi.
   */
  async create(
    principal: CustomerPrincipal,
    dto: CreateOrderDto,
    idempotencyKey: string | undefined,
    lang: Lang,
    tenant: Pick<Tenant, 'currency' | 'defaultLanguage'>,
  ) {
    if (!idempotencyKey || !IDEMPOTENCY_KEY.test(idempotencyKey)) {
      throw new CustomerAuthException('idempotency_key_required', 'Idempotency-Key header (8-128 chars: A-Z a-z 0-9 _ -) is required');
    }
    const { tenantId: organizationId, customerId } = principal;
    const requestHash = hashOrderRequest(dto);

    // 1. Takror so'rov: xuddi shu kalit + xuddi shu tana → o'sha buyurtma. Boshqa tana → xato.
    const existing = await this.findByKey(customerId, idempotencyKey);
    if (existing) return this.replay(existing, requestHash, lang);

    // 2. Mijoz
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, organization_id: organizationId, deleted_at: null },
      select: { id: true, status: true },
    });
    if (!customer) throw new CustomerAuthException('invalid_token');
    if (customer.status === 'blocked') throw new CustomerAuthException('customer_blocked');

    const settings = await this.settings.get(organizationId);
    const mode = dto.fulfillmentMode;

    // 3. Filial va ish vaqti
    const branch = await this.chooseBranch(organizationId, mode, dto.branchId);

    // 4. Manzil va zona (delivery)
    let addressSnapshot: Prisma.InputJsonValue | undefined;
    if (mode === 'delivery') {
      if (!dto.addressId) throw new CustomerAuthException('validation_error', 'addressId is required for delivery');
      const address = await this.prisma.customer_address.findFirst({ where: { id: dto.addressId, customer_id: customerId } });
      if (!address) throw new CustomerAuthException('address_not_found');

      const zoneProblem = deliveryZoneProblem(settings.deliveryZone, address);
      if (zoneProblem === 'delivery_unavailable_no_zone') {
        throw new CustomerAuthException(zoneProblem, 'Delivery is unavailable: the venue has no delivery zone');
      }
      if (zoneProblem) throw new CustomerAuthException(zoneProblem, 'Address is outside the delivery zone');
      addressSnapshot = toAddressView(address) as unknown as Prisma.InputJsonValue;
    }

    // 5. To'lov usuli: naqd doim, onlayn — tenant kalitlarini kiritgan bo'lsa
    const online = dto.paymentMethod !== 'cash';
    if (online && !(await this.payments.enabledProviders(organizationId)).has(dto.paymentMethod as 'click' | 'payme')) {
      throw new CustomerAuthException('payment_method_unavailable', 'This payment method is not available');
    }

    // 6. Narxlash (faqat bazadagi narxlar)
    const products = await this.loadProducts(organizationId, dto.items.map((i) => i.itemId));
    const { lines, subtotal } = priceLines(dto.items, products, lang, tenant.defaultLanguage);

    const serviceFee = mode === 'delivery' ? settings.deliveryServiceFee : 0;
    const totals = computeTotals(subtotal, serviceFee);

    // 7. Mijoz ko'rgan summa bilan solishtirish (narx o'zgargan bo'lsa yangi narxlar bilan 409)
    if (dto.expectedTotal != null && dto.expectedTotal !== totals.total) {
      throw new CustomerAuthException('price_changed', 'Prices have changed', undefined, {
        items: lines.map((l, index) => ({ index, unitPrice: l.unitPrice })),
        subtotal: totals.subtotal,
        serviceFee: totals.serviceFee,
        total: totals.total,
      });
    }

    const minAmount = mode === 'delivery' ? settings.minOrderDelivery : settings.minOrderPickup;
    if (totals.subtotal < minAmount) {
      throw new CustomerAuthException('min_order_not_reached', 'Order is below the minimum amount', undefined, { minAmount });
    }

    // 8. Suiiste'moldan himoya
    const active = await this.prisma.customer_order.count({
      where: { customer_id: customerId, status: { in: [...ACTIVE_STATUSES] } },
    });
    if (active >= settings.maxActiveOrders) {
      throw new CustomerAuthException('too_many_active_orders', 'Too many active orders', 60);
    }

    // 9. Yozish
    const now = Date.now();
    const status: OrderStatusName = online ? 'awaiting_payment' : 'pending_acceptance';
    const paymentExpiresAt = online ? new Date(now + settings.paymentTimeoutSeconds * 1000) : null;

    let order: OrderWithItems;
    try {
      order = (await this.prisma.$transaction(async (tx) => {
        const [{ order_seq: number }] = await tx.$queryRaw<{ order_seq: number }[]>`
          UPDATE organization SET order_seq = order_seq + 1 WHERE id = ${organizationId} RETURNING order_seq`;

        const created = await tx.customer_order.create({
          data: {
            number,
            organization_id: organizationId,
            customer_id: customerId,
            branch_id: branch.id,
            status,
            fulfillment: mode,
            idempotency_key: idempotencyKey,
            request_hash: requestHash,
            phone: dto.phone,
            comment: dto.comment?.trim() || null,
            address_snapshot: addressSnapshot,
            payment_method: dto.paymentMethod,
            payment_status: online ? 'pending' : 'not_required',
            payment_expires_at: paymentExpiresAt,
            currency: tenant.currency,
            subtotal: totals.subtotal,
            service_fee: totals.serviceFee,
            discount: totals.discount,
            total: totals.total,
            eta_min: settings.etaMin,
            eta_max: settings.etaMax,
            placed_at: online ? null : new Date(now),
            items: {
              create: lines.map((l) => ({
                product_id: l.productId,
                name: l.name,
                image: l.image,
                weight: l.weight || null,
                base_price: l.basePrice,
                unit_price: l.unitPrice,
                quantity: l.quantity,
                position: l.position,
                options: {
                  create: l.options.map((o) => ({
                    group_id: o.groupId,
                    group_title: o.groupTitle,
                    option_id: o.optionId,
                    name: o.name,
                    price: o.price,
                    position: o.position,
                  })),
                },
              })),
            },
          },
          include: ORDER_INCLUDE,
        });

        await tx.order_status_event.create({
          data: { order_id: created.id, from_status: null, to_status: status, actor: 'customer', actor_id: customerId },
        });
        return created;
      })) as OrderWithItems;
    } catch (e) {
      // Ikkita bir xil so'rov bir vaqtda: ikkinchisi unique (customer_id, idempotency_key) ga urilib shu yerga tushadi.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const raced = await this.findByKey(customerId, idempotencyKey);
        if (raced) return this.replay(raced, requestHash, lang);
      }
      throw e;
    }

    // 10. Commit'dan keyin (fonda): restoranga xabar + eskalatsiya yoki to'lov muddati
    if (online) {
      this.transitions.dispatchEffects(order, [{ type: 'payment_window', expiresAt: paymentExpiresAt! }]);
    } else {
      this.transitions.dispatchEffects(order, [{ type: 'placed' }]);
    }

    return this.view(order, lang);
  }

  // -------------------------------------------------------------------- read

  async list(principal: CustomerPrincipal, opts: { activeOnly?: boolean }, lang: Lang) {
    const rows = await this.prisma.customer_order.findMany({
      where: {
        customer_id: principal.customerId,
        organization_id: principal.tenantId,
        ...(opts.activeOnly ? { status: { in: [...ACTIVE_STATUSES] } } : {}),
      },
      orderBy: { created_at: 'desc' },
      take: 50,
      include: ORDER_INCLUDE,
    });
    // Ro'yxatda to'lov havolasi qurilmaydi (har buyurtma uchun sozlamani ochish kerak bo'lardi).
    return rows.map((o) => toOrderView(o as OrderWithItems));
  }

  async get(principal: CustomerPrincipal, id: string, lang: Lang) {
    let order = await this.findOwn(principal, id);

    // Navbat o'chgan bo'lsa ham to'lov muddati tugagan buyurtma o'z-o'zidan tuzatiladi.
    if (order.status === 'awaiting_payment' && order.payment_expires_at && order.payment_expires_at <= new Date()) {
      try {
        await this.transitions.transition({ orderId: id, to: 'payment_failed', actor: 'system', note: 'expired' });
        order = await this.findOwn(principal, id);
      } catch (e) {
        if (!(e instanceof InvalidTransitionError)) throw e; // to'lov aynan shu daqiqada o'tgan — qayta o'qiymiz
        order = await this.findOwn(principal, id);
      }
    }
    return this.view(order, lang);
  }

  // ----------------------------------------------------------------- actions

  async cancel(principal: CustomerPrincipal, id: string, lang: Lang) {
    const order = await this.findOwn(principal, id);
    if (order.status === 'cancelled') return this.view(order, lang); // ikki marta bekor qilish xato emas

    if (!CUSTOMER_CANCELLABLE.has(order.status as OrderStatusName)) {
      throw new CustomerAuthException('cancel_not_allowed', 'The order can no longer be cancelled');
    }
    try {
      await this.transitions.transition({ orderId: id, to: 'cancelled', actor: 'customer', actorId: principal.customerId, reason: 'customer_cancelled' });
    } catch (e) {
      // Restoran/to'lov shu soniyada oldinroq o'tgan — bekor qilish endi mumkin emas.
      if (e instanceof InvalidTransitionError) {
        const fresh = await this.findOwn(principal, id);
        if (fresh.status === 'cancelled') return this.view(fresh, lang);
        throw new CustomerAuthException('cancel_not_allowed', 'The order can no longer be cancelled');
      }
      throw e;
    }
    return this.view(await this.findOwn(principal, id), lang);
  }

  async retryPayment(principal: CustomerPrincipal, id: string, lang: Lang) {
    const order = await this.findOwn(principal, id);
    if (order.status !== 'payment_failed' || order.payment_method === 'cash') {
      throw new CustomerAuthException('payment_not_retryable', 'Payment cannot be retried now');
    }
    if (!(await this.payments.enabledProviders(order.organization_id)).has(order.payment_method as 'click' | 'payme')) {
      throw new CustomerAuthException('payment_method_unavailable', 'This payment method is not available');
    }

    const settings = await this.settings.get(order.organization_id);
    try {
      await this.transitions.transition({
        orderId: id,
        to: 'awaiting_payment',
        actor: 'customer',
        actorId: principal.customerId,
        paymentExpiresAt: new Date(Date.now() + settings.paymentTimeoutSeconds * 1000),
      });
    } catch (e) {
      if (e instanceof InvalidTransitionError) throw new CustomerAuthException('payment_not_retryable', 'Payment cannot be retried now');
      throw e;
    }
    return this.view(await this.findOwn(principal, id), lang);
  }

  // ----------------------------------------------------------------- helpers

  private findByKey(customerId: string, key: string) {
    return this.prisma.customer_order.findUnique({
      where: { customer_id_idempotency_key: { customer_id: customerId, idempotency_key: key } },
      include: ORDER_INCLUDE,
    });
  }

  private async replay(existing: NonNullable<Awaited<ReturnType<OrderService['findByKey']>>>, requestHash: string, lang: Lang) {
    if (existing.request_hash !== requestHash) {
      throw new CustomerAuthException('idempotency_key_reused', 'Idempotency-Key was already used with a different request');
    }
    return this.view(existing as OrderWithItems, lang);
  }

  private async findOwn(principal: CustomerPrincipal, id: string): Promise<OrderWithItems> {
    // Boshqa mijoz yoki boshqa tenant buyurtmasi — "topilmadi" (mavjudligini sezdirmaymiz).
    const order = await this.prisma.customer_order.findFirst({
      where: { id, customer_id: principal.customerId, organization_id: principal.tenantId },
      include: ORDER_INCLUDE,
    });
    if (!order) throw new CustomerAuthException('order_not_found', 'Order not found');
    return order as OrderWithItems;
  }

  private async view(order: OrderWithItems, lang: Lang) {
    const paymentUrl = order.status === 'awaiting_payment' ? await this.links.buildUrl(order, lang) : null;

    let failReason: 'declined' | 'expired' | 'cancelled' | null = null;
    if (order.status === 'payment_failed') {
      const event = await this.prisma.order_status_event.findFirst({ where: { order_id: order.id, to_status: 'payment_failed' }, orderBy: { id: 'desc' } });
      failReason = event?.note === 'expired' || event?.note === 'cancelled' ? event.note : 'declined';
    }
    return toOrderView(order, { paymentUrl, failReason });
  }

  private loadProducts(organizationId: string, ids: string[]): Promise<Map<string, PricingProduct>> {
    return this.prisma.product
      .findMany({
        where: { id: { in: [...new Set(ids)] }, category: { organization_id: organizationId } },
        include: {
          translations: true,
          images: { orderBy: { created_at: 'asc' } },
          additional_product_groups: {
            orderBy: { created_at: 'asc' },
            include: { translations: true, additional_products: { orderBy: { created_at: 'asc' }, include: { translations: true } } },
          },
          category: { select: { is_active: true } },
        },
      })
      .then((rows) => new Map(rows.map((p) => [p.id, p as unknown as PricingProduct])));
  }

  /**
   * Filial tanlash. pickup: mijoz tanlagan filial (ochiq bo'lishi shart). delivery:
   * so'ralgan filial ochiq bo'lsa u, aks holda yetkazib beradigan birinchi ochiq filial.
   * Hech biri ochiq bo'lmasa — branch_closed (eng yaqin ochilish vaqti bilan).
   */
  private async chooseBranch(organizationId: string, mode: 'delivery' | 'pickup', requestedId?: string) {
    const all = await this.branches.listActiveWithState(organizationId);
    const supports = (b: (typeof all)[number]) => (mode === 'pickup' ? b.branch.accepts_pickup : b.branch.accepts_delivery);
    // isOpen === null (jadval kiritilmagan) — bloklamaymiz.
    const isOpen = (b: (typeof all)[number]) => b.state.isOpen !== false;

    if (mode === 'pickup') {
      if (!requestedId) throw new CustomerAuthException('validation_error', 'branchId is required for pickup');
      const chosen = all.find((b) => b.branch.id === requestedId);
      if (!chosen) throw new CustomerAuthException('validation_error', 'Branch not found');
      if (!supports(chosen)) throw new CustomerAuthException('fulfillment_unavailable', 'This branch does not offer pickup');
      if (!isOpen(chosen)) throw new CustomerAuthException('branch_closed', 'Branch is closed', undefined, { opensAt: chosen.state.opensAt });
      return chosen.branch;
    }

    if (requestedId && !all.some((b) => b.branch.id === requestedId)) {
      throw new CustomerAuthException('validation_error', 'Branch not found');
    }
    const candidates = all.filter(supports);
    if (candidates.length === 0) throw new CustomerAuthException('fulfillment_unavailable', 'Delivery is not available');

    const preferred = candidates.find((b) => b.branch.id === requestedId && isOpen(b));
    const open = preferred ?? candidates.find(isOpen);
    if (!open) {
      const next = candidates.map((b) => b.state.opensAt).filter(Boolean).sort()[0] ?? null;
      throw new CustomerAuthException('branch_closed', 'All branches are closed', undefined, { opensAt: next });
    }
    return open.branch;
  }
}

export { OrderNotFoundError };
