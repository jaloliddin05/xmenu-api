import { ApiProperty } from '@nestjs/swagger';
import type { BranchView } from '../services/branch.service';

/** One item of GET /branches (docs/BRANCHES_API.md). */
export class BranchViewDto implements BranchView {
  @ApiProperty() id: string;
  @ApiProperty({ example: 'Main branch' }) title: string;
  @ApiProperty({ example: 'Main street 1' }) address: string;
  @ApiProperty({ example: 41.311081 }) latitude: number;
  @ApiProperty({ example: 69.240562 }) longitude: number;
  @ApiProperty({
    example: 'Mon-Sun 10:00-23:00',
    description: 'Working hours in the response language',
  })
  hours: string;
  @ApiProperty({ type: String, nullable: true, example: '+998711234567' })
  phone: string | null;
  @ApiProperty({
    type: Boolean,
    nullable: true,
    description: 'null: no working hours set',
  })
  isOpen: boolean | null;
  @ApiProperty({
    type: String,
    nullable: true,
    example: '09:00',
    description: 'HH:mm when a closed branch opens next',
  })
  opensAt: string | null;
}
