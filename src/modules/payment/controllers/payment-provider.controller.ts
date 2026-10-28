import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseEnumPipe, Post, Put, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { requireStaffOrganizationId } from 'src/infra/http/request-helpers';
import { UpsertPaymentProviderDto } from '../dto/payment-provider.dto';
import type { OnlineProvider } from '../services/payment-config.service';
import { PaymentConfigService } from '../services/payment-config.service';

enum ProviderParam {
  click = 'click',
  payme = 'payme',
}

/** Restoran paneli: Click/Payme kalitlarini kiritish. Kalitlar shifrlanadi, qaytarilmaydi. */
@ApiTags('Payment providers')
@Controller('payment-provider')
export class PaymentProviderController {
  constructor(private readonly configs: PaymentConfigService) {}

  @Get()
  @ApiOperation({ summary: 'Yoqilgan/sozlangan provayderlar + kabinetga kiritiladigan webhook manzillari' })
  async list(@Req() req) {
    const orgId = requireStaffOrganizationId(req);
    const base = (process.env.PUBLIC_API_URL ?? '').replace(/\/$/, '');
    return {
      providers: await this.configs.list(orgId),
      // URL carries the organization id: it never changes, so renaming the slug cannot break the cabinet settings
      webhooks: {
        click: { prepare: `${base}/payments/click/${orgId}/prepare`, complete: `${base}/payments/click/${orgId}/complete` },
        payme: { endpoint: `${base}/payments/payme/${orgId}` },
      },
    };
  }

  @Put(':provider')
  @ApiOperation({ summary: 'Provayder kalitlarini saqlash (shifrlanadi) va yoqish' })
  upsert(@Param('provider', new ParseEnumPipe(ProviderParam)) provider: OnlineProvider, @Body() dto: UpsertPaymentProviderDto, @Req() req) {
    return this.configs.upsert(requireStaffOrganizationId(req), provider, dto.config, dto.isEnabled ?? true);
  }

  @Post(':provider/disable')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Provayderni o'chirish (kalitlar saqlanadi)" })
  async disable(@Param('provider', new ParseEnumPipe(ProviderParam)) provider: OnlineProvider, @Req() req) {
    await this.configs.setEnabled(requireStaffOrganizationId(req), provider, false);
  }
}
