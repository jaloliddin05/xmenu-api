import { Injectable, Logger } from '@nestjs/common';
import { fieldErrorsException } from 'src/infra/validators/validation-errors';
import { PrismaService } from '../../_prisma/prisma.service';
import { CustomerAuthException } from 'src/modules/auth/errors/customer-auth.exception';
import { TenantService } from 'src/modules/tenant/tenant.service';
import { RevalidateService } from 'src/modules/revalidate-queue/revalidate.service';
import {
  OrganizationSettings,
  settingsProblems,
  toSettingsData,
  toSettingsView,
} from '../domain/organization-settings';

/** The owner's venue settings (organization_settings): one row per venue, created at signup. */
@Injectable()
export class OrganizationSettingsService {
  private readonly logger = new Logger(OrganizationSettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenants: TenantService,
    private readonly revalidate: RevalidateService,
  ) {}

  async get(organizationId: string): Promise<OrganizationSettings> {
    const row = await this.prisma.organization_settings.findUnique({
      where: { organization_id: organizationId },
    });
    if (!row) throw this.missing(organizationId);
    return toSettingsView(row);
  }

  /** Replaces the whole settings document (PUT). */
  async replace(
    organizationId: string,
    settings: OrganizationSettings,
  ): Promise<OrganizationSettings> {
    const problems = settingsProblems(settings);
    if (problems.length) throw fieldErrorsException('invalid_settings', problems);
    await this.get(organizationId);
    const row = await this.prisma.organization_settings.update({
      where: { organization_id: organizationId },
      data: toSettingsData(settings),
    });
    // Customer endpoints read language and currency from the cached tenant
    this.tenants.invalidate(organizationId);
    await this.revalidate.addRevalidationJob({ tenantId: organizationId, route: 'settings' });
    return toSettingsView(row);
  }

  private missing(organizationId: string) {
    this.logger.error(
      `organization_settings row missing for organization ${organizationId}`,
    );
    return new CustomerAuthException(
      'settings_missing',
      'Venue settings are missing',
    );
  }
}
