import { randomBytes, randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { AppException } from 'src/infra/errors/app-exception';
import {
  PLATFORM_ORDER_SETTINGS,
  PLATFORM_SETTINGS,
} from './domain/platform-defaults';
import { OrganizationService } from './services/organization.service';

/**
 * DELETE /organization/:id (OrganizationService.delete) on a real PostgreSQL: the venue has a row of every kind
 * that hangs off an organization, directly or through a child (translations, menu, branches, POS, couriers,
 * guests, finished orders with payments). Every relation to organization must say what happens on delete,
 * or the delete fails with a foreign key error (organization_translation did: every signup writes two).
 * Runs where DATABASE_URL points at an xmenu_* database.
 */
// These tests write rows, so they run only on a throwaway database named xmenu_* (CI: xmenu_ci), never on a dev
// database that happens to be in .env
const url = /\/xmenu_[^/?]*(\?.*)?$/.test(process.env.DATABASE_URL ?? '')
  ? process.env.DATABASE_URL
  : undefined;
const describeDb = url ? describe : describe.skip;

const uniq = () => randomUUID().slice(0, 8);
const digits = () => String(Math.floor(Math.random() * 1e7)).padStart(7, '0');

describeDb(
  'organization delete with every kind of child row (PostgreSQL)',
  () => {
    let prisma: PrismaClient;
    let service: OrganizationService;
    const unschedule = jest.fn(async () => undefined);

    beforeAll(() => {
      prisma = new PrismaClient({ datasourceUrl: url });
      service = new OrganizationService(
        prisma as any,
        {} as any,
        {} as any,
        { invalidate: jest.fn() } as any,
        {} as any,
        { unschedule } as any,
      );
    });
    afterAll(async () => {
      await prisma.$disconnect();
    });
    beforeEach(() => unschedule.mockClear());

    async function seed(orderStatus: 'completed' | 'pending_acceptance') {
      const org = await prisma.organization.create({
        data: {
          name: `del-${uniq()}`,
          settings: { create: PLATFORM_SETTINGS },
          order_settings: { create: PLATFORM_ORDER_SETTINGS },
          translations: {
            create: [
              { lang: 'uz', description: '' },
              { lang: 'ru', description: 'Описание' },
            ],
          },
          members: {
            create: {
              role: 'owner',
              status: 'invited',
              phone: `+99890${digits()}`,
              first_name: 'O',
            },
          },
          employees: {
            create: {
              first_name: 'E',
              phone: `+99891${digits()}`,
              password: 'x',
              url: 'x',
              status: 'active',
            },
          },
          payment_providers: {
            create: { provider: 'click', config_encrypted: 'v1:x' },
          },
          telegram_bot: {
            create: {
              telegram_bot_id: `9${digits()}${digits()}`,
              username: `b_${uniq()}_bot`,
              token_encrypted: 'v1:x',
              webhook_secret_hash: 'h',
            },
          },
          domains: {
            create: { host: `${uniq()}.example.uz`, verification_token: 't' },
          },
          delivery_area: {
            create: {
              base_price: 9000,
              included_km: 2,
              price_per_km: 1500,
              min_order: 0,
            },
          },
          delivery_area_parts: {
            create: [
              {
                position: 0,
                source: 'region',
                region_code: 'UZ-TK',
                catalog_version: 'osm-test',
                geometry: [
                  [
                    [41.2, 69.1],
                    [41.2, 69.4],
                    [41.4, 69.4],
                  ],
                ],
              },
              {
                position: 1,
                source: 'custom',
                geometry: [
                  [
                    [41.3, 69.2],
                    [41.3, 69.3],
                    [41.35, 69.25],
                  ],
                ],
              },
            ],
          },
        },
      });
      const orgId = org.id;

      const category = await prisma.category.create({
        data: {
          organization_id: orgId,
          translations: { create: { lang: 'ru', title: 'Супы' } },
        },
      });
      const product = await prisma.product.create({
        data: {
          category_id: category.id,
          price: 1000,
          unit: 'gr',
          translations: { create: { lang: 'ru', title: 'Борщ' } },
          images: { create: { url: 'u', path: 'p' } },
        },
      });
      const group = await prisma.additional_product_group.create({
        data: {
          organization_id: orgId,
          product_id: product.id,
          translations: { create: { lang: 'ru', title: 'Хлеб' } },
          additional_products: {
            create: {
              price: 100,
              translations: { create: { lang: 'ru', title: 'Лаваш' } },
            },
          },
        },
        include: { additional_products: true },
      });
      const option = group.additional_products[0];

      const branch = await prisma.branch.create({
        data: {
          organization_id: orgId,
          title: 'B',
          address: 'A',
          latitude: 41.3,
          longitude: 69.2,
          working_hours: { create: { weekday: 1, is_24h: true } },
          hours_exceptions: {
            create: { date: new Date('2026-12-31'), is_closed: true },
          },
          delivery_zones: {
            create: {
              position: 0,
              polygon: [
                [41.3, 69.2],
                [41.31, 69.2],
                [41.31, 69.21],
              ],
              price: 5000,
              min_order: 0,
            },
          },
          delivery_distance: {
            create: {
              base_price: 5000,
              included_km: 2,
              price_per_km: 1000,
              max_km: 10,
              min_order: 0,
            },
          },
        },
      });

      const pos = await prisma.pos_integration.create({
        data: {
          organization_id: orgId,
          branch_links: {
            create: { branch_id: branch.id, terminal_group_id: 'tg' },
          },
          payment_links: {
            create: {
              method: 'cash',
              payment_type_id: 'pt',
              payment_type_kind: 'Cash',
            },
          },
          menu_links: {
            create: [
              {
                kind: 'category',
                external_id: 'c1',
                category_id: category.id,
                source_name: 'Супы',
              },
              {
                kind: 'product',
                external_id: 'p1',
                product_id: product.id,
                source_name: 'Борщ',
              },
              {
                kind: 'modifier_group',
                external_id: 'g1',
                group_id: group.id,
                source_name: 'Хлеб',
              },
              {
                kind: 'modifier',
                external_id: 'm1',
                option_id: option.id,
                source_name: 'Лаваш',
              },
            ],
          },
          stop_items: {
            create: { branch_id: branch.id, product_id: product.id },
          },
        },
      });

      const courier = await prisma.courier.create({
        data: {
          organization_id: orgId,
          name: 'C',
          phone: '+998900000002',
          invitations: {
            create: {
              token_hash: randomBytes(16).toString('hex'),
              expires_at: new Date(Date.now() + 3600_000),
            },
          },
        },
      });
      const shift = await prisma.courier_shift.create({
        data: { organization_id: orgId, courier_id: courier.id },
      });

      const customer = await prisma.customer.create({
        data: {
          organization_id: orgId,
          phone: '+998900000001',
          name: 'G',
          addresses: { create: { address: 'Street 1' } },
          sessions: {
            create: {
              family_id: randomUUID(),
              family_started_at: new Date(),
              organization_id: orgId,
              token_hash: randomBytes(32),
              expires_at: new Date(Date.now() + 3600_000),
            },
          },
        },
      });

      const order = await prisma.customer_order.create({
        data: {
          number: 1,
          organization_id: orgId,
          customer_id: customer.id,
          branch_id: branch.id,
          courier_id: courier.id,
          courier_shift_id: shift.id,
          status: orderStatus,
          fulfillment: 'delivery',
          idempotency_key: randomUUID(),
          request_hash: 'h',
          phone: '+998900000001',
          payment_method: 'click',
          payment_status: 'paid',
          currency: 'UZS',
          subtotal: 1100,
          total: 1100,
          items: {
            create: {
              product_id: product.id,
              name: 'Борщ',
              base_price: 1000,
              unit_price: 1100,
              quantity: 1,
              position: 0,
              options: {
                create: {
                  group_id: group.id,
                  group_title: 'Хлеб',
                  option_id: option.id,
                  name: 'Лаваш',
                  price: 100,
                  position: 0,
                },
              },
            },
          },
          events: {
            create: {
              from_status: 'pending_acceptance',
              to_status: orderStatus,
              actor: 'restaurant',
            },
          },
          payments: {
            create: { provider: 'click', status: 'paid', amount: 1100 },
          },
          courier_cards: {
            create: { courier_id: courier.id, chat_id: '1', message_id: 1 },
          },
          pos_order: { create: { integration_id: pos.id } },
        },
      });
      // A staff browser subscribed to the venue's order notifications (the user itself outlives the venue)
      const staffUser = await prisma.user.create({
        data: { phone: `+99893${digits()}`, isActive: true },
      });
      await prisma.staff_push_subscription.create({
        data: {
          user_id: staffUser.id,
          organization_id: orgId,
          endpoint: `https://fcm.googleapis.com/fcm/send/${uniq()}`,
          p256dh: 'p',
          auth: 'a',
        },
      });

      return {
        orgId,
        posId: pos.id,
        ids: {
          branchId: branch.id,
          productId: product.id,
          groupId: group.id,
          optionId: option.id,
          categoryId: category.id,
          courierId: courier.id,
          customerId: customer.id,
          orderId: order.id,
        },
      };
    }

    /** Rows of the venue in every table that can hold them. */
    async function rows(
      orgId: string,
      ids: Awaited<ReturnType<typeof seed>>['ids'],
    ) {
      const byOrg = { organization_id: orgId };
      const counts: Record<string, number> = {
        organization: await prisma.organization.count({ where: { id: orgId } }),
        organization_translation: await prisma.organization_translation.count({
          where: byOrg,
        }),
        organization_settings: await prisma.organization_settings.count({
          where: byOrg,
        }),
        organization_order_settings:
          await prisma.organization_order_settings.count({ where: byOrg }),
        organization_member: await prisma.organization_member.count({
          where: byOrg,
        }),
        employee: await prisma.employee.count({ where: byOrg }),
        staff_push_subscription: await prisma.staff_push_subscription.count({
          where: byOrg,
        }),
        organization_payment_provider:
          await prisma.organization_payment_provider.count({ where: byOrg }),
        organization_telegram_bot: await prisma.organization_telegram_bot.count(
          {
            where: byOrg,
          },
        ),
        tenant_domain: await prisma.tenant_domain.count({ where: byOrg }),
        delivery_area: await prisma.delivery_area.count({ where: byOrg }),
        delivery_area_part: await prisma.delivery_area_part.count({
          where: byOrg,
        }),
        category: await prisma.category.count({ where: byOrg }),
        category_translation: await prisma.category_translation.count({
          where: { category_id: ids.categoryId },
        }),
        product: await prisma.product.count({ where: { id: ids.productId } }),
        product_translation: await prisma.product_translation.count({
          where: { product_id: ids.productId },
        }),
        file: await prisma.file.count({ where: { product_id: ids.productId } }),
        additional_product_group: await prisma.additional_product_group.count({
          where: byOrg,
        }),
        additional_product_group_translation:
          await prisma.additional_product_group_translation.count({
            where: { additional_product_group_id: ids.groupId },
          }),
        additional_product: await prisma.additional_product.count({
          where: { id: ids.optionId },
        }),
        additional_product_translation:
          await prisma.additional_product_translation.count({
            where: { additional_product_id: ids.optionId },
          }),
        branch: await prisma.branch.count({ where: byOrg }),
        branch_working_hours: await prisma.branch_working_hours.count({
          where: { branch_id: ids.branchId },
        }),
        branch_hours_exception: await prisma.branch_hours_exception.count({
          where: { branch_id: ids.branchId },
        }),
        branch_delivery_zone: await prisma.branch_delivery_zone.count({
          where: { branch_id: ids.branchId },
        }),
        branch_delivery_distance: await prisma.branch_delivery_distance.count({
          where: { branch_id: ids.branchId },
        }),
        pos_integration: await prisma.pos_integration.count({ where: byOrg }),
        pos_branch_link: await prisma.pos_branch_link.count({
          where: { branch_id: ids.branchId },
        }),
        pos_payment_link: await prisma.pos_payment_link.count({
          where: { integration: byOrg },
        }),
        pos_menu_link: await prisma.pos_menu_link.count({
          where: { integration: byOrg },
        }),
        pos_stop_item: await prisma.pos_stop_item.count({
          where: { branch_id: ids.branchId },
        }),
        pos_order: await prisma.pos_order.count({
          where: { order_id: ids.orderId },
        }),
        courier: await prisma.courier.count({ where: byOrg }),
        courier_invitation: await prisma.courier_invitation.count({
          where: { courier_id: ids.courierId },
        }),
        courier_shift: await prisma.courier_shift.count({ where: byOrg }),
        courier_card: await prisma.courier_card.count({
          where: { courier_id: ids.courierId },
        }),
        customer: await prisma.customer.count({ where: byOrg }),
        customer_address: await prisma.customer_address.count({
          where: { customer_id: ids.customerId },
        }),
        customer_session: await prisma.customer_session.count({
          where: { customer_id: ids.customerId },
        }),
        customer_order: await prisma.customer_order.count({ where: byOrg }),
        customer_order_item: await prisma.customer_order_item.count({
          where: { order_id: ids.orderId },
        }),
        customer_order_item_option:
          await prisma.customer_order_item_option.count({
            where: { item: { order_id: ids.orderId } },
          }),
        order_status_event: await prisma.order_status_event.count({
          where: { order_id: ids.orderId },
        }),
        order_payment: await prisma.order_payment.count({
          where: { order_id: ids.orderId },
        }),
      };
      return counts;
    }

    it('a venue with every kind of child row and a finished order is deleted completely', async () => {
      const { orgId, posId, ids } = await seed('completed');
      const before = await rows(orgId, ids);
      for (const [table, n] of Object.entries(before))
        expect([table, n > 0]).toEqual([table, true]);

      await service.delete(orgId, orgId);

      const after = await rows(orgId, ids);
      for (const [table, n] of Object.entries(after))
        expect([table, n]).toEqual([table, 0]);
      expect(unschedule).toHaveBeenCalledWith(posId);
    });

    it('a venue with an unfinished order is refused with has_active_orders and keeps every row and its iiko schedule', async () => {
      const { orgId, ids } = await seed('pending_acceptance');
      const before = await rows(orgId, ids);

      const err = await service.delete(orgId, orgId).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(AppException);
      expect((err as AppException).code).toBe('has_active_orders');
      expect((err as AppException).details).toEqual({ activeOrders: 1 });
      expect(await rows(orgId, ids)).toEqual(before);
      expect(unschedule).not.toHaveBeenCalled();

      // Clean up: finish the order, then the delete goes through
      await prisma.customer_order.update({
        where: { id: ids.orderId },
        data: { status: 'cancelled' },
      });
      await service.delete(orgId, orgId);
      expect(await prisma.organization.count({ where: { id: orgId } })).toBe(0);
    });
  },
);
