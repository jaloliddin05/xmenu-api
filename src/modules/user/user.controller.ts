import { Controller, Get, Post, Body, Param, Delete, Put, HttpCode, HttpStatus, Req } from '@nestjs/common';
import { UserService } from './user.service';
import { CreateUserDto, UpdateUserDto } from './dto';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

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

  @Put(':id')
  @ApiOperation({ summary: 'Method: update' })
  @HttpCode(HttpStatus.OK)
  update(@Param('id') id: string, @Body() data: UpdateUserDto) {
    return this.userService.update(id, data);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Method: delete' })
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.userService.delete(id);
  }
}
