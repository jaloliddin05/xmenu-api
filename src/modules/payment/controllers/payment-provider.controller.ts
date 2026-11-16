import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  requireStaffOrganizationId,
  type StaffRequest,
} from 'src/infra/http/request-helpers';
import { UpsertPaymentProviderDto } from '../dto/payment-provider.dto';
import type { OnlineProvider } from '../services/payment-config.service';
import { PaymentConfigService } from '../services/payment-config.service';
import { StaffAccess } from 'src/modules/auth/access/staff-access.decorator';
import { RevalidateService } from 'src/modules/revalidate-queue/revalidate.service';

enum ProviderParam {
  click = 'click',
  payme = 'payme',
}

/** Restoran paneli: Click/Payme kalitlarini kiritish. Kalitlar shifrlanadi, qaytarilmaydi. */
@ApiTags('Payment providers')
@Controller('payment-provider')
export class PaymentProviderController {
  constructor(
    private readonly configs: PaymentConfigService,
    private readonly revalidate: RevalidateService,
  ) {}

  /** Online payment at delivery is part of the delivery site's config (fulfillment.deliveryPaymentMethods) */
  private async changed(organizationId: string) {
    await this.revalidate.addRevalidationJob({
      tenantId: organizationId,
      route: 'settings',
    });
  }

  @StaffAccess('venue')
  @Get()
  @ApiOperation({
    summary:
      'Yoqilgan/sozlangan provayderlar + kabinetga kiritiladigan webhook manzillari',
  })
  async list(@Req() req: StaffRequest) {
    const orgId = requireStaffOrganizationId(req);
    const base = (process.env.PUBLIC_API_URL ?? '').replace(/\/$/, '');
    return {
      providers: await this.configs.list(orgId),
      // URL carries the organization id: it never changes, so renaming the slug cannot break the cabinet settings
      webhooks: {
        click: {
          prepare: `${base}/payments/click/${orgId}/prepare`,
          complete: `${base}/payments/click/${orgId}/complete`,
        },
        payme: { endpoint: `${base}/payments/payme/${orgId}` },
      },
    };
  }

  @StaffAccess('venue')
  @Put(':provider')
  @ApiOperation({
    summary: 'Provayder kalitlarini saqlash (shifrlanadi) va yoqish',
  })
  async upsert(
    @Param('provider', new ParseEnumPipe(ProviderParam))
    provider: OnlineProvider,
    @Body() dto: UpsertPaymentProviderDto,
    @Req() req: StaffRequest,
  ) {
    const organizationId = requireStaffOrganizationId(req);
    const result = await this.configs.upsert(
      organizationId,
      provider,
      dto.config,
      dto.isEnabled ?? true,
    );
    await this.changed(organizationId);
    return result;
  }

  @StaffAccess('venue')
  @Post(':provider/disable')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Provayderni o'chirish (kalitlar saqlanadi)" })
  async disable(
    @Param('provider', new ParseEnumPipe(ProviderParam))
    provider: OnlineProvider,
    @Req() req: StaffRequest,
  ) {
    const organizationId = requireStaffOrganizationId(req);
    await this.configs.setEnabled(organizationId, provider, false);
    await this.changed(organizationId);
  }
}
