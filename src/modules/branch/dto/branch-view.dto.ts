import { ApiProperty } from '@nestjs/swagger';
import type { BranchStatus } from '../domain/branch-hours';
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
    description: 'Open right now; false also when the branch has no working hours (see status)',
  })
  isOpen: boolean;
  @ApiProperty({
    type: String,
    nullable: true,
    example: '09:00',
    description: 'HH:mm when a closed branch opens next',
  })
  opensAt: string | null;
  @ApiProperty({
    enum: ['open', 'closed_now', 'no_schedule', 'closed_all_days'],
    description:
      'open; closed_now (closed, opensAt says when it opens); no_schedule (owner never entered hours); closed_all_days (hours exist but nothing opens in the next 7 days)',
  })
  status: BranchStatus;
}
