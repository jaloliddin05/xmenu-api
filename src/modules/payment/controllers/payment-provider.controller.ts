import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseEnumPipe, Post, Put, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { requireStaffOrganizationId } from 'src/infra/http/request-helpers';
import { PrismaService } from 'src/modules/_prisma/prisma.service';
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
  constructor(
    private readonly configs: PaymentConfigService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Yoqilgan/sozlangan provayderlar + kabinetga kiritiladigan webhook manzillari' })
  async list(@Req() req) {
    const orgId = requireStaffOrganizationId(req);
    const org = await this.prisma.organization.findUnique({ where: { id: orgId }, select: { slug: true } });
    const base = (process.env.PUBLIC_API_URL ?? '').replace(/\/$/, '');
    return {
      providers: await this.configs.list(orgId),
      webhooks: org?.slug
        ? {
            click: { prepare: `${base}/payments/click/${org.slug}/prepare`, complete: `${base}/payments/click/${org.slug}/complete` },
            payme: { endpoint: `${base}/payments/payme/${org.slug}` },
          }
        : null,
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
