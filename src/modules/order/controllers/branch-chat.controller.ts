import {
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import {
  requireStaffOrganizationId,
  type StaffRequest,
} from 'src/infra/http/request-helpers';
import { StaffAccess } from 'src/modules/auth/access/staff-access.decorator';
import { BranchChatBindingService } from '../services/branch-chat-binding.service';

class BranchChatCodeDto {
  @ApiProperty({
    example: 'K7QW2M9P',
    description:
      'One-time code: send `/bind <code>` to the platform bot in the branch group',
  })
  code: string;

  @ApiProperty({ example: 600, description: 'Seconds until the code expires' })
  expiresIn: number;

  @ApiProperty({
    nullable: true,
    example: 'xmenu_orders_bot',
    description:
      'Username of the platform orders bot to add to the group; null if Telegram did not answer',
  })
  botUsername: string | null;
}

/**
 * The chat of a branch for new orders (S-09): set only by `/bind CODE` sent from that chat to the platform bot
 * (TelegramOrdersController), never typed in by the owner.
 */
@ApiTags('Branch')
@Controller('branch')
export class BranchChatController {
  constructor(private readonly binding: BranchChatBindingService) {}

  @StaffAccess('venue')
  @Post(':id/telegram-chat/code')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'One-time code to bind a Telegram group to the branch (8 characters, 10 minutes); a new code cancels the previous one',
  })
  @ApiOkResponse({ type: BranchChatCodeDto })
  @ApiNotFoundResponse({ description: 'not_found: no such branch here' })
  createCode(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: StaffRequest,
  ): Promise<BranchChatCodeDto> {
    return this.binding.createCode(requireStaffOrganizationId(req), id);
  }

  @StaffAccess('venue')
  @Delete(':id/telegram-chat')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Unbind the Telegram chat of the branch: new orders stop going there',
  })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ description: 'not_found: no such branch here' })
  async unbind(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: StaffRequest,
  ): Promise<void> {
    await this.binding.unbind(requireStaffOrganizationId(req), id);
  }
}
