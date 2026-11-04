import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, tenant_domain } from '@prisma/client';
import { randomBytes } from 'crypto';
import { fieldErrorsException } from 'src/infra/validators/validation-errors';
import { PrismaService } from '../_prisma/prisma.service';
import { RevalidateService } from '../revalidate-queue/revalidate.service';
import {
  hostToUnicode,
  HostProblem,
  parseCustomHost,
  platformDomainFrom,
} from '../tenant/host';
import {
  PRIMARY_DOMAIN_SELECT,
  primaryDomainOf,
} from '../tenant/primary-domain';
import { TenantService } from '../tenant/tenant.service';
import {
  DOMAIN_VERIFIER,
  verifyRecordName,
  verifyRecordValue,
} from './domain-verifier';
import type { DomainOwnershipVerifier } from './domain-verifier';
import { TenantDomainDto, TenantDomainListDto } from './dto/tenant-domain.dto';

/** Domains a venue may have, pending ones included. */
export const TENANT_DOMAIN_LIMIT = 5;

const HOST_PROBLEM_TEXT: Record<HostProblem, string> = {
  invalid_host:
    'host must be a bare domain name such as order.restaurant.uz (no scheme, path or port)',
  platform_host:
    'host belongs to the platform: the venue already has its platform address',
  reserved_host:
    'host is a special-use name (localhost, .local, .internal) or an IP address',
};

const domainTaken = () =>
  new ConflictException({
    code: 'domain_taken',
    message: 'The domain is verified by another venue',
  });

const domainNotFound = () =>
  new NotFoundException({
    code: 'domain_not_found',
    message: 'Domain not found',
  });

function isUniqueViolation(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
  );
}

export function toDomainView(
  row: tenant_domain,
  primaryDomain: string | null,
): TenantDomainDto {
  return {
    id: row.id,
    host: row.host,
    hostUnicode: hostToUnicode(row.host),
    status: row.status,
    isPrimary: row.status === 'verified' && row.host === primaryDomain,
    createdAt: row.created_at,
    verifiedAt: row.verified_at,
    lastCheckAt: row.last_check_at,
    lastCheckError: row.last_check_error,
    verification: {
      type: 'TXT',
      name: verifyRecordName(row.host),
      value: verifyRecordValue(row.verification_token),
    },
  };
}

/**
 * The owner's own domains (modules/tenant-domain). A host becomes the venue's only after the
 * ownership check (DNS TXT, domain-verifier.ts); a pending host resolves to nobody. A verified host
 * belongs to one venue (tenant_domain.verified_host is unique), so a second venue gets 409 and a
 * pending claim by someone else never blocks the real owner.
 */
@Injectable()
export class TenantDomainService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenants: TenantService,
    private readonly revalidate: RevalidateService,
    @Inject(DOMAIN_VERIFIER)
    private readonly verifier: DomainOwnershipVerifier,
  ) {}

  async list(organizationId: string): Promise<TenantDomainListDto> {
    const [org, rows] = await Promise.all([
      this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { slug: true, domains: PRIMARY_DOMAIN_SELECT },
      }),
      this.prisma.tenant_domain.findMany({
        where: { organization_id: organizationId },
        orderBy: [{ created_at: 'asc' }, { host: 'asc' }],
      }),
    ]);
    const platformDomain = platformDomainFrom();
    const primaryDomain = primaryDomainOf(org?.domains);
    return {
      platformHost:
        org?.slug && platformDomain ? `${org.slug}.${platformDomain}` : null,
      primaryDomain,
      limit: TENANT_DOMAIN_LIMIT,
      items: rows.map((r) => toDomainView(r, primaryDomain)),
    };
  }

  async add(organizationId: string, rawHost: string): Promise<TenantDomainDto> {
    const parsed = parseCustomHost(rawHost, platformDomainFrom());
    if ('problem' in parsed) {
      throw fieldErrorsException(parsed.problem, [
        {
          field: 'host',
          reason: parsed.problem,
          message: HOST_PROBLEM_TEXT[parsed.problem],
        },
      ]);
    }
    const { host } = parsed;

    // The venue row lock makes the limit count and the insert one step for concurrent adds
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM organization WHERE id = ${organizationId} FOR UPDATE`;
      const verified = await tx.tenant_domain.findUnique({
        where: { verified_host: host },
        select: { organization_id: true },
      });
      if (verified && verified.organization_id !== organizationId)
        throw domainTaken();
      const own = await tx.tenant_domain.findUnique({
        where: {
          organization_id_host: { organization_id: organizationId, host },
        },
        select: { id: true },
      });
      if (own) {
        throw new ConflictException({
          code: 'domain_already_added',
          message: 'The venue already has this domain',
        });
      }
      const count = await tx.tenant_domain.count({
        where: { organization_id: organizationId },
      });
      if (count >= TENANT_DOMAIN_LIMIT) {
        throw new UnprocessableEntityException({
          code: 'domain_limit_reached',
          message: `A venue can have at most ${TENANT_DOMAIN_LIMIT} domains`,
          details: { limit: TENANT_DOMAIN_LIMIT },
        });
      }
      return tx.tenant_domain.create({
        data: {
          organization_id: organizationId,
          host,
          verification_token: randomBytes(24).toString('base64url'),
        },
      });
    });

    if (this.verifier.verifiesOnAdd) return this.verify(organizationId, row.id);
    return toDomainView(row, await this.primaryDomain(organizationId));
  }

  /** Runs the ownership check; a verified domain answers as is. */
  async verify(
    organizationId: string,
    domainId: string,
  ): Promise<TenantDomainDto> {
    const row = await this.own(organizationId, domainId);
    if (row.status === 'verified') {
      return toDomainView(row, await this.primaryDomain(organizationId));
    }

    const result = await this.verifier.check(row.host, row.verification_token);
    const now = new Date();
    if (!result.ok) {
      await this.recordFailure(row.id, now, result.reason);
      throw new UnprocessableEntityException({
        code: 'domain_verification_failed',
        message: `Ownership check failed: ${result.reason}`,
        details: {
          reason: result.reason,
          record: toDomainView(row, null).verification,
        },
      });
    }

    let changed: number;
    try {
      // Conditional: of concurrent checks of this row only one flips it
      ({ count: changed } = await this.prisma.tenant_domain.updateMany({
        where: { id: row.id, status: 'pending' },
        data: {
          status: 'verified',
          verified_host: row.host,
          verified_at: now,
          last_check_at: now,
          last_check_error: null,
        },
      }));
    } catch (e) {
      // Another venue verified the same host first (verified_host is unique)
      if (!isUniqueViolation(e)) throw e;
      await this.recordFailure(row.id, now, 'domain_taken');
      throw domainTaken();
    }
    if (changed) await this.changed(organizationId, row.host);
    return toDomainView(
      await this.own(organizationId, domainId),
      await this.primaryDomain(organizationId),
    );
  }

  async remove(organizationId: string, domainId: string): Promise<void> {
    const row = await this.own(organizationId, domainId);
    const { count } = await this.prisma.tenant_domain.deleteMany({
      where: { id: row.id, organization_id: organizationId },
    });
    // A pending host never resolved to the venue: nothing public changes
    if (count && row.status === 'verified')
      await this.changed(organizationId, row.host);
  }

  /** A domain of this venue; another venue's id looks missing. */
  private async own(
    organizationId: string,
    domainId: string,
  ): Promise<tenant_domain> {
    const row = await this.prisma.tenant_domain.findFirst({
      where: { id: domainId, organization_id: organizationId },
    });
    if (!row) throw domainNotFound();
    return row;
  }

  private async primaryDomain(organizationId: string): Promise<string | null> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { domains: PRIMARY_DOMAIN_SELECT },
    });
    return primaryDomainOf(org?.domains);
  }

  private recordFailure(id: string, at: Date, reason: string) {
    return this.prisma.tenant_domain.update({
      where: { id },
      data: { last_check_at: at, last_check_error: reason },
    });
  }

  /** The host now resolves to the venue, or no longer does: by-host answers and primaryDomain change. */
  private async changed(organizationId: string, host: string) {
    this.tenants.invalidate(organizationId);
    await this.revalidate.addRevalidationJob({
      tenantId: organizationId,
      route: 'domains',
      host,
    });
  }
}
