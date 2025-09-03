import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../_prisma/prisma.service';
import { Employee } from '../models/employee.model';
import { hashPassword } from 'src/infra/helper';
import { CreateEmployeeDto, UpdateEmployeeDto } from '../dto';

@Injectable()
export class EmployeeService {
  constructor(
    private readonly prismaService:PrismaService
  ){}

  async create(data: CreateEmployeeDto) {
    const password = await hashPassword(data.password)
    return await this.prismaService.employee.create({data:{...data,password}})
  }

  async findAll() {
    return await this.prismaService.employee.findMany()
  }

  async findOne(id: string) {
    return await this.prismaService.employee.findUnique({where:{id}})
  }

  async findByPhone(phone: string): Promise<Employee | null> {
    return await this.prismaService.employee.findUnique({
      where: {
        phone
      }
    });
  }

  async update(id: string, data: UpdateEmployeeDto) {
    return await this.prismaService.employee.update({data,where:{id}})
  }

  async delete(id: string) {
    return await this.prismaService.employee.delete({where:{id}})
  }
}
