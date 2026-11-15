import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import formatPhoneNumber from 'src/infra/helper/auth/format-phone';
import { STAFF_ROLES } from 'src/modules/auth/access/permissions';
import type { StaffRole } from 'src/modules/auth/access/permissions';
import { STAFF_MEMBER_STATUSES } from '../domain/staff-member';
import type { StaffMemberStatus } from '../domain/staff-member';

const toPhone = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? formatPhoneNumber(value) : value;
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class InviteStaffDto {
  @ApiProperty({ example: '+998901234567', description: 'Operator phone' })
  @IsString()
  @IsNotEmpty()
  @Transform(toPhone)
  readonly phone: string;

  @ApiProperty({ example: 'Dilshod', maxLength: 64 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  readonly first_name: string;

  @ApiPropertyOptional({ example: 'Karimov', maxLength: 64 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(64)
  readonly last_name?: string;
}

export class StaffMemberDto {
  @ApiProperty({ description: 'Pass to POST …/staff/{memberId}/disable' })
  id: string;
  @ApiProperty({ enum: STAFF_ROLES }) role: StaffRole;
  @ApiProperty({
    enum: STAFF_MEMBER_STATUSES,
    description:
      'invited: waits for the operator; expired: the invitation ran out (invite again); active; disabled',
  })
  status: StaffMemberStatus;
  @ApiProperty({ example: '+998901234567' }) phone: string;
  @ApiProperty() firstName: string;
  @ApiProperty({ type: String, nullable: true }) lastName: string | null;
  @ApiProperty({ description: 'When the row was created (invited)' })
  invitedAt: Date;
  @ApiProperty({
    type: Date,
    nullable: true,
    description: 'Until when an open invitation can be accepted',
  })
  inviteExpiresAt: Date | null;
  @ApiProperty({ type: Date, nullable: true }) activatedAt: Date | null;
  @ApiProperty({ type: Date, nullable: true }) disabledAt: Date | null;
}
