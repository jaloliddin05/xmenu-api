import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  requireStaffOrganizationId,
  type StaffRequest,
} from 'src/infra/http/request-helpers';
import { StaffAccess } from 'src/modules/auth/access/staff-access.decorator';
import {
  PosAcceptedDto,
  PosCourierModeDto,
  PosDictionariesDto,
  PosDisconnectedDto,
  PosEnableDto,
  PosKeyDto,
  PosKeyResultDto,
  PosLinksDto,
  PosOrganizationDto,
  PosOrganizationsDto,
  PosPreviewDto,
  PosRematchDto,
  PosStatusDto,
} from '../dto/pos-iiko.dto';
import { PosIntegrationService } from '../services/pos-integration.service';

/**
 * Connecting the venue to iiko (owner only). Neither the key nor the webhook address is ever
 * returned. Contract: docs/API.md, "Интеграция с кассой (iiko)".
 */
@ApiTags('POS (iiko)')
@Controller('integrations/iiko')
export class PosIikoController {
  constructor(private readonly pos: PosIntegrationService) {}

  @StaffAccess('venue')
  @Get()
  @ApiOperation({ summary: 'Status, steps, links and the last checks' })
  @ApiOkResponse({ type: PosStatusDto })
  status(@Req() req: StaffRequest) {
    return this.pos.status(requireStaffOrganizationId(req));
  }

  @StaffAccess('venue')
  @Put('key')
  @ApiOperation({
    summary:
      'Step 1: the restaurant API key (checked by getting a token, stored encrypted); answers the iiko organizations',
  })
  @ApiOkResponse({ type: PosKeyResultDto })
  setKey(@Body() dto: PosKeyDto, @Req() req: StaffRequest) {
    return this.pos.setKey(requireStaffOrganizationId(req), dto.apiKey);
  }

  @StaffAccess('venue')
  @Get('organizations')
  @ApiOperation({ summary: 'iiko organizations of the key' })
  @ApiOkResponse({ type: PosOrganizationsDto })
  organizations(@Req() req: StaffRequest) {
    return this.pos.organizations(requireStaffOrganizationId(req));
  }

  @StaffAccess('venue')
  @Put('organization')
  @ApiOperation({
    summary:
      'Step 2: the iiko organization; its address format is read at once',
  })
  @ApiOkResponse({ type: PosStatusDto })
  setOrganization(@Body() dto: PosOrganizationDto, @Req() req: StaffRequest) {
    return this.pos.setOrganization(
      requireStaffOrganizationId(req),
      dto.externalOrgId,
    );
  }

  @StaffAccess('venue')
  @Get('dictionaries')
  @ApiOperation({
    summary:
      'Terminal groups (cash desk online), payment types, external menus, price categories, items for "Delivery"',
  })
  @ApiOkResponse({ type: PosDictionariesDto })
  dictionaries(@Req() req: StaffRequest) {
    return this.pos.dictionaries(requireStaffOrganizationId(req));
  }

  @StaffAccess('venue')
  @Put('links')
  @ApiOperation({
    summary:
      'Steps 3–5: branches ↔ terminal groups, payment methods ↔ payment types, the "Delivery" item, external menu and price category (replaces all)',
  })
  @ApiOkResponse({ type: PosStatusDto })
  setLinks(@Body() dto: PosLinksDto, @Req() req: StaffRequest) {
    return this.pos.setLinks(requireStaffOrganizationId(req), dto);
  }

  @StaffAccess('venue')
  @Post('menu/preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'What enabling (or "match again") does: pairs by name, new iiko positions, dishes to hide',
  })
  @ApiOkResponse({ type: PosPreviewDto })
  preview(@Req() req: StaffRequest) {
    return this.pos.preview(requireStaffOrganizationId(req));
  }

  @StaffAccess('venue')
  @Post('checks')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Run the checks: delivery module, key rights, cash desks online',
  })
  @ApiOkResponse({ type: PosStatusDto })
  checks(@Req() req: StaffRequest) {
    return this.pos.runChecks(requireStaffOrganizationId(req));
  }

  @StaffAccess('venue')
  @Post('enable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Enable: all steps and checks green, menu imported with the confirmed pairs, webhook set in iiko',
  })
  @ApiOkResponse({ type: PosStatusDto })
  enable(@Body() dto: PosEnableDto, @Req() req: StaffRequest) {
    return this.pos.enable(requireStaffOrganizationId(req), dto.matches);
  }

  @StaffAccess('venue')
  @Post('menu/import')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary:
      '"Обновить меню": queues an import (the result shows in GET: menuImportedAt, menuImportError)',
  })
  @ApiOkResponse({ type: PosAcceptedDto })
  importMenu(@Req() req: StaffRequest) {
    return this.pos.importNow(requireStaffOrganizationId(req));
  }

  @StaffAccess('venue')
  @Post('menu/rematch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      '"Сопоставить заново": imports the menu now pairing the dishes without a link (as on enabling); dishes left without a pair are hidden',
  })
  @ApiOkResponse({ type: PosStatusDto })
  rematch(@Body() dto: PosRematchDto, @Req() req: StaffRequest) {
    return this.pos.rematch(requireStaffOrganizationId(req), dto.matches);
  }

  @StaffAccess('venue')
  @Put('couriers')
  @ApiOperation({
    summary:
      'Courier mode: Xmenu or iiko couriers (only without open delivery orders)',
  })
  @ApiOkResponse({ type: PosStatusDto })
  setCouriers(@Body() dto: PosCourierModeDto, @Req() req: StaffRequest) {
    return this.pos.setCourierMode(requireStaffOrganizationId(req), dto.mode);
  }

  @StaffAccess('venue')
  @Delete()
  @ApiOperation({
    summary:
      'Disconnect: the webhook is removed in iiko, dishes stay as ordinary Xmenu dishes, the history of sent orders stays; waits up to 10 s for a running menu import (409 pos_busy after)',
  })
  @ApiOkResponse({ type: PosDisconnectedDto })
  disconnect(@Req() req: StaffRequest) {
    return this.pos.disconnect(requireStaffOrganizationId(req));
  }
}
