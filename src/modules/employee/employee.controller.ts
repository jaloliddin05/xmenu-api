// import { Controller, Get, Post, Body, Param, Delete, Put, HttpCode, HttpStatus } from '@nestjs/common';
// import { CreateEmployeeDto, UpdateEmployeeDto } from './dto';
// import { ApiOperation, ApiTags } from '@nestjs/swagger';
// import { EmployeeService } from './services/employee.service';

// @ApiTags('Employee')
// @Controller('employee')
// export class EmployeeController {
//   constructor(private readonly employeeService: EmployeeService) { }

//   @Get()
//   @ApiOperation({ summary: 'Method: get all' })
//   @HttpCode(HttpStatus.OK)
//   async findAll() {
//     return await this.employeeService.findAll();
//   }

//   @Get(':id')
//   @ApiOperation({ summary: 'Method: get one' })
//   @HttpCode(HttpStatus.OK)
//   async findOne(@Param('id') id: string) {
//     return await this.employeeService.findOne(id);
//   }

//   @Post()
//   @ApiOperation({ summary: 'Method: create' })
//   @HttpCode(HttpStatus.CREATED)
//   async create(@Body() data: CreateEmployeeDto) {
//     return await this.employeeService.create(data);
//   }

//   @Put(':id')
//   @ApiOperation({ summary: 'Method: update' })
//   @HttpCode(HttpStatus.OK)
//   async update(@Param('id') id: string, @Body() data: UpdateEmployeeDto) {
//     return await this.employeeService.update(id, data);
//   }

//   @Delete(':id')
//   @ApiOperation({ summary: 'Method: delete' })
//   @HttpCode(HttpStatus.NO_CONTENT)
//   async remove(@Param('id') id: string) {
//     return await this.employeeService.delete(id);
//   }
// }
