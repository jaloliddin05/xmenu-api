import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
import { REDIS } from 'src/infra/redis/redis.module';
import { CustomerRepository } from 'src/modules/customer/repositories/customer.repository';
import { CustomerService, CustomerUser } from 'src/modules/customer/services/customer.service';
import type { Tenant } from 'src/modules/tenant/tenant.service';
import { isValidPhone, normalizeCustomerName } from 'src/infra/helper/auth/customer-validators';
import type { CustomerAuthConfig } from '../customer-auth.config.ts';
import { CustomerAuthException } from '../errors/customer-auth.exception';
import { CustomerOtpService } from './customer-otp.service';
import { CustomerSessionService, TokenPair } from './customer-session.service';
import { CustomerTokenService } from './customer-token.service';
import { CustomerAuthEventService, RequestCtx } from './customer-auth-event.service';
import { RateLimitService } from './rate-limit.service';
import { TelegramInitDataService } from './telegram-init-data.service';

type Customer = NonNullable<Awaited<ReturnType<CustomerRepository['findById']>>>;
const CUSTOMER_AUTH_CONFIG = 'CUSTOMER_AUTH_CONFIG';

export type VerifyResult =
  | ({ isNewUser: false; user: CustomerUser } & TokenPair)
  | { isNewUser: true; registrationToken: string };

@Injectable()
export class CustomerAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customers: CustomerRepository,
    private readonly customerService: CustomerService,
    private readonly otp: CustomerOtpService,
    private readonly sessions: CustomerSessionService,
    private readonly tokens: CustomerTokenService,
    private readonly events: CustomerAuthEventService,
    private readonly rateLimit: RateLimitService,
    private readonly telegram: TelegramInitDataService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(CUSTOMER_AUTH_CONFIG) private readonly cfg: CustomerAuthConfig,
  ) {}

  // ================= POST otp/request =================

  async requestOtp(tenant: Tenant, phone: string, ctx: RequestCtx): Promise<{ resendAfter: number }> {
    if (!isValidPhone(phone)) throw new CustomerAuthException('invalid_phone');

    try {
      const resendAfter = await this.otp.request(tenant, phone, ctx.ip);
      await this.events.log('otp_requested', ctx, { tenantId: tenant.id, phone });
      return { resendAfter };
    } catch (err) {
      if (err instanceof CustomerAuthException && err.code === 'sms_unavailable') {
        await this.events.log('otp_send_failed', ctx, { tenantId: tenant.id, phone });
      }
      throw err;
    }
  }

  // ================= POST otp/verify =================

  async verifyOtp(
    tenant: Tenant,
    dto: { phone: string; code: string; initData?: string },
    ctx: RequestCtx,
  ): Promise<VerifyResult> {
    const { phone, code } = dto;
    if (!isValidPhone(phone)) throw new CustomerAuthException('invalid_phone');
    // Format xato bo'lsa urinish sarflanmaydi
    if (!this.otp.isValidCodeFormat(code)) throw new CustomerAuthException('invalid_code');

    await this.rateLimit.hit([
      { key: `verify:rl:${phone}:${ctx.ip}`, limit: 10, ttlSeconds: 900 },
      { key: `verify:rl:ip:${ctx.ip}`, limit: 60, ttlSeconds: 900 },
    ]);

    await this.otp.consume(tenant.id, phone, code, {
      onFailed: () => this.events.log('otp_failed', ctx, { tenantId: tenant.id, phone }),
      onLocked: () => this.events.log('otp_locked', ctx, { tenantId: tenant.id, phone }),
    });
    await this.events.log('otp_verified', ctx, { tenantId: tenant.id, phone });

    const customer = await this.customers.findByPhone(tenant.id, phone);

    if (!customer) {
      // Hech narsa yaratilmaydi: faqat bir martalik registration token beriladi
      return { isNewUser: true, registrationToken: this.tokens.signRegistration(phone, tenant.id) };
    }

    this.assertActive(customer, tenant, ctx, 'otp_verify');
    if (dto.initData) await this.tryLinkTelegram(tenant.id, customer.id, dto.initData);

    const pair = await this.login(customer, tenant, ctx);
    return { isNewUser: false, ...pair, user: this.customerService.toUser(customer) };
  }

  // ================= POST register =================

  async register(
    tenant: Tenant,
    dto: { registrationToken: string; name: string; initData?: string },
    ctx: RequestCtx,
  ): Promise<TokenPair & { user: CustomerUser }> {
    await this.rateLimit.hit([{ key: `reg:rl:ip:${ctx.ip}`, limit: 20, ttlSeconds: 3600 }]);

    const claims = this.tokens.verifyRegistration(dto.registrationToken, tenant.id);

    const name = normalizeCustomerName(dto.name);
    if (!name) throw new CustomerAuthException('invalid_name');

    // Bir martalik: token "yoqiladi"
    const burned = await this.redis.set(`reg:used:${claims.jti}`, '1', 'EX', 600, 'NX');
    if (burned !== 'OK') throw new CustomerAuthException('registration_expired');

    const telegramId = dto.initData ? this.safeTelegramId(dto.initData) : null;

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const taken = telegramId ? await this.customers.findByTelegramId(tenant.id, telegramId) : null;
        const customer = await this.customers.create(
          tenant.id,
          { phone: claims.phone, name, telegram_id: taken ? null : telegramId, last_login_at: new Date() },
          tx,
        );
        const pair = await this.sessions.createSession(tx, customer.id, tenant.id, ctx);
        return { ...pair, user: this.customerService.toUser(customer) };
      });
      await this.events.log('registered', ctx, { tenantId: tenant.id, customerId: result.user.id, phone: claims.phone });
      return result;
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;

      // Parallel ikkinchi token shu raqamga mijoz yaratib bo'lgan: raqam ikki marta kod bilan
      // tasdiqlangan, shuning uchun mavjud mijozga kiramiz. Ism ustiga yozilmaydi.
      const existing = await this.customers.findByPhone(tenant.id, claims.phone);
      if (!existing) throw err;
      this.assertActive(existing, tenant, ctx, 'register');
      const pair = await this.login(existing, tenant, ctx);
      return { ...pair, user: this.customerService.toUser(existing) };
    }
  }

  // ================= POST refresh / logout / me =================

  async refresh(tenant: Tenant, refreshToken: string, ctx: RequestCtx): Promise<TokenPair> {
    await this.rateLimit.hit([{ key: `refresh:rl:ip:${ctx.ip}`, limit: 60, ttlSeconds: 60 }]);
    return this.sessions.refresh(refreshToken, tenant.id, ctx);
  }

  async logout(tenant: Tenant, refreshToken: string | undefined, ctx: RequestCtx): Promise<void> {
    await this.sessions.logout(refreshToken, tenant.id, ctx);
  }

  async me(tenantId: string, customerId: string): Promise<CustomerUser> {
    const customer = await this.customers.findById(tenantId, customerId);
    if (!customer) throw new CustomerAuthException('invalid_token');
    if (customer.status === 'blocked') throw new CustomerAuthException('customer_blocked');
    return this.customerService.toUser(customer);
  }

  // ================= Telegram strategiyasi =================

  /** Telegram initData orqali kirish: faqat allaqachon ulangan mijoz uchun. */
  async telegramLogin(
    tenant: Tenant,
    initData: string,
    ctx: RequestCtx,
  ): Promise<VerifyResult | { isNewUser: true; requiresPhone: true }> {
    const tgUser = this.telegram.verify(initData);
    const customer = await this.customers.findByTelegramId(tenant.id, String(tgUser.id));

    if (!customer) {
      // Yangi: telefon OTP orqali tasdiqlanishi shart (otp/request -> otp/verify -> register + initData)
      return { isNewUser: true, requiresPhone: true };
    }
    this.assertActive(customer, tenant, ctx, 'telegram');
    const pair = await this.login(customer, tenant, ctx);
    return { isNewUser: false, ...pair, user: this.customerService.toUser(customer) };
  }

  // ================= yordamchilar =================

  private assertActive(customer: Customer, tenant: Tenant, ctx: RequestCtx, via: string) {
    if (customer.status === 'blocked') {
      void this.events.log('customer_blocked_attempt', ctx, {
        tenantId: tenant.id,
        customerId: customer.id,
        phone: customer.phone,
        meta: { via },
      });
      throw new CustomerAuthException('customer_blocked');
    }
  }

  private async login(customer: Customer, tenant: Tenant, ctx: RequestCtx): Promise<TokenPair> {
    const pair = await this.prisma.$transaction(async (tx) => {
      await tx.customer.update({ where: { id: customer.id }, data: { last_login_at: new Date() } });
      return this.sessions.createSession(tx, customer.id, tenant.id, ctx);
    });
    await this.events.log('login', ctx, { tenantId: tenant.id, customerId: customer.id, phone: customer.phone });
    return pair;
  }

  private safeTelegramId(initData: string): string | null {
    try {
      return String(this.telegram.verify(initData).id);
    } catch {
      return null; // noto'g'ri initData telefon orqali kirishni to'sib qo'ymasin
    }
  }

  private async tryLinkTelegram(tenantId: string, customerId: string, initData: string) {
    const telegramId = this.safeTelegramId(initData);
    if (!telegramId) return;
    const owner = await this.customers.findByTelegramId(tenantId, telegramId);
    if (owner) return; // allaqachon band (shu yoki boshqa mijozga)
    await this.customers.update(tenantId, customerId, { telegram_id: telegramId }).catch(() => undefined);
  }
}
