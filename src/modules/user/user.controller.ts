import { Controller, Get, Post, Body, Param, Delete, Put, HttpCode, HttpStatus, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { UserService } from './user.service';
import { ChangePasswordDto, CreateUserDto, UpdateUserDto } from './dto';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { MulterStorage } from 'src/infra/helper/upload/multer-upload';
import { FileUploadValidationForOptional } from 'src/infra/validators/file-upload-validation-update';

@ApiTags('User')
@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) { }

  @Get()
  @ApiOperation({ summary: 'Method: get all' })
  @HttpCode(HttpStatus.OK)
  findAll() {
    return this.userService.findAll();
  }

  @Get('/me')
  @ApiOperation({ summary: 'Method: returns user' })
  @HttpCode(HttpStatus.OK)
  async getMe(@Req() req) {
    return await this.userService.findOne(req.user.id);
  }

  @Post()
  @ApiOperation({ summary: 'Method: create' })
  @HttpCode(HttpStatus.CREATED)
  create(@Body() data: CreateUserDto) {
    return this.userService.create(data);
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
    @UploadedFile(FileUploadValidationForOptional) file: Express.Multer.File){
    return this.userService.update(id, data,file);
  }

  @Put('/change-password/:id')
  @ApiOperation({ summary: 'Method: updating user password' })
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @Body() data: ChangePasswordDto,
    @Param('id') id: string,
  ) {
    return await this.userService.changePassword(data, id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Method: delete' })
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.userService.delete(id);
  }
}
