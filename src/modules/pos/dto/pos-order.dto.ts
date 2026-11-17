import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length, MaxLength } from 'class-validator';

// ---- Requests ----

export class PosManualDto {
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Order number in iiko, if the operator has it',
    example: '1042',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  readonly posNumber?: string | null;
}

export class PosStreetDto {
  @ApiProperty({ description: 'Street id from GET .../pos/streets' })
  @IsString()
  @Length(1, 100)
  readonly streetId: string;

  @ApiProperty({ description: 'House number as iiko takes it', example: '12А' })
  @IsString()
  @Length(1, 50)
  readonly house: string;
}

// ---- Responses ----

export class PosStreetViewDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ description: 'City of the street in iiko' })
  city: string;
}

export class PosStreetsDto {
  @ApiProperty({ type: [PosStreetViewDto] })
  items: PosStreetViewDto[];
}
