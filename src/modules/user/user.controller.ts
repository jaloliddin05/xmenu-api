import { Controller, Get, Body, Param, Delete, Put, HttpCode, HttpStatus, Req, UploadedFile, UseInterceptors, NotFoundException } from '@nestjs/common';
import { UserService } from './user.service';
import { ChangePasswordDto, UpdateUserDto } from './dto';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { MulterStorage } from 'src/infra/helper/upload/multer-upload';
import { FileUploadValidationForOptional } from 'src/infra/validators/file-upload-validation-update';

/** An owner may only act on their own account; anyone else's id looks like it does not exist. */
export function assertSelf(req: { user?: { id?: string } }, id: string): string {
  if (!req.user?.id || req.user.id !== id) throw new NotFoundException('User not found');
  return id;
}

@ApiTags('User')
@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) { }

  @Get('/me')
  @ApiOperation({ summary: 'Method: returns user' })
  @HttpCode(HttpStatus.OK)
  async getMe(@Req() req) {
    return await this.userService.findOne(req.user.id);
  }

  @Put('/:id')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Method: updating user' })
  @UseInterceptors(
    FileInterceptor('avatar', {
      storage: MulterStorage('uploads/image/profile'),
    }),
  )
  @HttpCode(HttpStatus.OK)
  async update(
    @Body() data: UpdateUserDto,
    @Param('id') id: string,
    @Req() req,
    @UploadedFile(FileUploadValidationForOptional) file: Express.Multer.File){
    return this.userService.update(assertSelf(req, id), data,file);
  }

  @Put('/change-password/:id')
  @ApiOperation({ summary: 'Method: updating user password' })
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @Body() data: ChangePasswordDto,
    @Param('id') id: string,
    @Req() req,
  ) {
    return await this.userService.changePassword(data, assertSelf(req, id));
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Method: delete' })
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @Req() req) {
    return this.userService.delete(assertSelf(req, id));
  }
}
