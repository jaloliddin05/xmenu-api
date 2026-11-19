import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  ValidateNested,
} from 'class-validator';

const ID_MAX = 100;

// ---- Requests ----

export class PosKeyDto {
  @ApiProperty({
    description:
      'API key the restaurant created in iikoWeb. Stored encrypted; never returned',
    example: 'b1c2d3e4f5',
  })
  @IsString()
  @Length(1, 200)
  readonly apiKey: string;
}

export class PosOrganizationDto {
  @ApiProperty({ description: 'iiko organization id (GET .../organizations)' })
  @IsString()
  @Length(1, ID_MAX)
  readonly externalOrgId: string;
}

export class PosBranchLinkDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  readonly branchId: string;

  @ApiProperty({ description: 'iiko terminal group id' })
  @IsString()
  @Length(1, ID_MAX)
  readonly terminalGroupId: string;
}

export class PosBranchLinkInputDto extends PosBranchLinkDto {
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description:
      'One price category for the venue: null or the same as `priceCategoryId` of the links, another one is rejected (`price_category_differs`); not stored',
  })
  @IsOptional()
  @IsString()
  @MaxLength(ID_MAX)
  readonly priceCategoryId?: string | null;
}

export class PosPaymentLinkDto {
  @ApiProperty({ enum: ['cash', 'card', 'online'] })
  @IsIn(['cash', 'card', 'online'])
  readonly method: 'cash' | 'card' | 'online';

  @ApiProperty({ description: 'iiko payment type id' })
  @IsString()
  @Length(1, ID_MAX)
  readonly paymentTypeId: string;
}

export class PosDeliveryItemDto {
  @ApiProperty({ description: 'iiko item (productId) of the external menu' })
  @IsString()
  @Length(1, ID_MAX)
  readonly itemId: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(ID_MAX)
  readonly sizeId?: string | null;
}

export class PosLinksDto {
  @ApiProperty({ description: 'External menu id (GET .../dictionaries)' })
  @IsString()
  @Length(1, ID_MAX)
  readonly externalMenuId: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description:
      'Price category of the external menu, one for the venue: the menu prices are imported in it and every order carries it (deliveries/create priceCategoryId); null = iiko default',
  })
  @IsOptional()
  @IsString()
  @MaxLength(ID_MAX)
  readonly priceCategoryId?: string | null;

  @ApiProperty({ type: [PosBranchLinkInputDto] })
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => PosBranchLinkInputDto)
  readonly branches: PosBranchLinkInputDto[];

  @ApiProperty({ type: [PosPaymentLinkDto] })
  @IsArray()
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => PosPaymentLinkDto)
  readonly payments: PosPaymentLinkDto[];

  @ApiPropertyOptional({
    type: PosDeliveryItemDto,
    nullable: true,
    description:
      'Service item "Delivery": the delivery fee goes to iiko as this position',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => PosDeliveryItemDto)
  readonly deliveryItem?: PosDeliveryItemDto | null;
}

export class PosMatchDto {
  @ApiProperty({ format: 'uuid', description: 'Xmenu dish' })
  @IsUUID()
  readonly productId: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'iiko item it pairs with; null = no pair (the dish is hidden)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(ID_MAX)
  readonly itemId: string | null;
}

export class PosEnableDto {
  @ApiPropertyOptional({
    type: [PosMatchDto],
    description:
      'Pairs the owner confirmed in the preview; dishes not listed pair by exact name',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => PosMatchDto)
  readonly matches?: PosMatchDto[];
}

export class PosRematchDto {
  @ApiPropertyOptional({
    type: [PosMatchDto],
    description:
      'Pairs the owner confirmed in the preview; dishes without a link not listed pair by exact name, the rest are hidden',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => PosMatchDto)
  readonly matches?: PosMatchDto[];
}

export class PosCourierModeDto {
  @ApiProperty({ enum: ['xmenu', 'iiko'] })
  @IsIn(['xmenu', 'iiko'])
  readonly mode: 'xmenu' | 'iiko';
}

// ---- Responses ----

export class PosCheckDto {
  @ApiProperty({ enum: ['delivery_module', 'key_access', 'terminal_alive'] })
  key: string;

  @ApiProperty({ enum: ['ok', 'fail', 'unknown'] })
  status: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'terminal_alive only' })
  branchId?: string;

  @ApiPropertyOptional({
    description:
      'Error code of a failed check: pos_module_missing, pos_access_denied, pos_access_blocked, pos_key_invalid, pos_unavailable',
  })
  code?: string;
}

export class PosStepsDto {
  @ApiProperty({ enum: ['done', 'todo'] }) key: string;
  @ApiProperty({ enum: ['done', 'todo'] }) organization: string;
  @ApiProperty({ enum: ['done', 'todo'] }) branches: string;
  @ApiProperty({ enum: ['done', 'todo'] }) payments: string;
  @ApiProperty({ enum: ['done', 'todo'] }) menu: string;
}

export class PosAlertDto {
  @ApiProperty({
    enum: ['menu_import_failed', 'key_revoked'],
    description:
      'menu_import_failed: the last menu import failed (menuImportError tells why); key_revoked: iiko rejects the key, the owner reconnects',
  })
  code: string;

  @ApiProperty({ format: 'date-time' })
  at: Date;
}

export class PosStatusDto {
  @ApiProperty({
    description:
      'The platform can connect iiko (its iiko application and key storage are set up); false: the connection form is not shown, connecting answers 503 platform_misconfigured',
  })
  available: boolean;

  @ApiProperty({
    description: 'False without an integration and after disconnecting',
  })
  connected: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    enum: ['draft', 'active', 'needs_reconnect'],
  })
  status: string | null;

  @ApiProperty({
    type: PosAlertDto,
    nullable: true,
    description:
      'What the owner is warned about (a banner); the branch chats got one message when it was raised',
  })
  alert: PosAlertDto | null;

  @ApiProperty({ type: PosStepsDto, nullable: true })
  steps: PosStepsDto | null;

  @ApiProperty({ type: String, nullable: true })
  externalOrgId: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    enum: ['city', 'legacy', 'international', 'int_no_postcode', 'unknown'],
    description:
      'How the iiko organization takes addresses (addressFormatType): city = a line with coordinates; the others = a street from the iiko directory and a house (matched from the address when it can be, otherwise the operator picks it)',
  })
  addressFormat: string | null;

  @ApiProperty({ enum: ['xmenu', 'iiko'] })
  courierMode: string;

  @ApiProperty({ type: String, nullable: true })
  externalMenuId: string | null;

  @ApiProperty({ type: String, nullable: true })
  priceCategoryId: string | null;

  @ApiProperty({ type: PosDeliveryItemDto, nullable: true })
  deliveryItem: PosDeliveryItemDto | null;

  @ApiProperty({ type: [PosBranchLinkDto] })
  branches: PosBranchLinkDto[];

  @ApiProperty({ type: [PosPaymentLinkDto] })
  payments: (PosPaymentLinkDto & { paymentTypeKind: string })[];

  @ApiProperty({ type: [PosCheckDto] })
  checks: PosCheckDto[];

  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  checkedAt: Date | null;

  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  menuImportedAt: Date | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Error code of the last failed menu import (the previous menu stays)',
  })
  menuImportError: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  stopListUpdatedAt: Date | null;

  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  enabledAt: Date | null;
}

export class PosNamedDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
}

/** PUT /integrations/iiko/key: the status plus the iiko organizations of the key. */
export class PosKeyResultDto extends PosStatusDto {
  @ApiProperty({ type: [PosNamedDto] })
  organizations: PosNamedDto[];
}

export class PosOrganizationsDto {
  @ApiProperty({ type: [PosNamedDto] })
  organizations: PosNamedDto[];
}

export class PosTerminalGroupDto extends PosNamedDto {
  @ApiProperty({
    type: Boolean,
    nullable: true,
    description: 'Cash desk online (null: unknown)',
  })
  isAlive: boolean | null;
}

export class PosPaymentTypeDto extends PosNamedDto {
  @ApiProperty({
    description: 'iiko paymentTypeKind: Cash, Card, External, ...',
  })
  kind: string;
}

export class PosServiceItemDto {
  @ApiProperty() itemId: string;
  @ApiProperty() name: string;
  @ApiProperty({
    type: [PosNamedDto],
    description: 'Sizes (id, name) when the item has several',
  })
  sizes: PosNamedDto[];
  @ApiProperty({
    description: 'iiko lets the order set its price (canSetOpenPrice)',
  })
  openPrice: boolean;
}

export class PosDictionariesDto {
  @ApiProperty({ type: [PosTerminalGroupDto] })
  terminalGroups: PosTerminalGroupDto[];
  @ApiProperty({ type: [PosPaymentTypeDto] })
  paymentTypes: PosPaymentTypeDto[];
  @ApiProperty({
    type: [PosNamedDto],
    description:
      'Empty: no external menu in iiko (the dashboard shows how to set it up)',
  })
  externalMenus: PosNamedDto[];
  @ApiProperty({ type: [PosNamedDto] })
  priceCategories: PosNamedDto[];
  @ApiProperty({
    type: [PosServiceItemDto],
    description:
      'Items of the chosen external menu (empty until one is chosen)',
  })
  serviceItems: PosServiceItemDto[];
}

export class PosPreviewPairDto {
  @ApiProperty({ format: 'uuid' }) productId: string;
  @ApiProperty({ type: String, nullable: true }) productTitle: string | null;
  @ApiProperty() itemId: string;
  @ApiProperty() itemName: string;
  @ApiProperty({ description: 'Paired by exact name (not confirmed yet)' })
  byName: boolean;
}

export class PosPreviewDto {
  @ApiProperty({ type: [PosPreviewPairDto] })
  pairs: PosPreviewPairDto[];
  @ApiProperty({
    type: 'array',
    items: {
      type: 'object',
      properties: { itemId: { type: 'string' }, name: { type: 'string' } },
    },
    description: 'iiko positions without a pair: created',
  })
  newItems: { itemId: string; name: string }[];
  @ApiProperty({
    type: 'array',
    items: {
      type: 'object',
      properties: {
        productId: { type: 'string' },
        title: { type: 'string', nullable: true },
      },
    },
    description: 'Dishes without a pair: hidden, not deleted',
  })
  unmatched: { productId: string; title: string | null }[];
}

export class PosDisconnectedDto {
  @ApiProperty({ example: false })
  connected: false;

  @ApiProperty({
    example: 0,
    description:
      'Orders already in iiko (being sent or sent) that are not finished yet: their statuses no longer come from iiko, the dashboard warns about them. The history of sent orders stays',
  })
  unfinishedOrders: number;
}

export class PosAcceptedDto {
  @ApiProperty({ example: true })
  queued: boolean;
}
