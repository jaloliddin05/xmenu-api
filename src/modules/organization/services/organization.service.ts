import { Injectable } from '@nestjs/common';
import { OrganizationType } from '@prisma/client';


import { PrismaService } from '../../_prisma/prisma.service';
import { CreateOrganizationDto, UpdateOrganizationDto } from '../dto';

@Injectable()
export class OrganizationService {
  constructor(
    private readonly prismaService:PrismaService
  ){}

  async create(data: CreateOrganizationDto,owner_id:string) {
    const organization = await this.prismaService.organization.findUnique({where:{owner_id}})

    if(organization){
      const updatedOrganization = await this.prismaService.organization.update({where:{id:organization.id},data:{...data,type:OrganizationType[data.type as keyof typeof OrganizationType]}})
      return updatedOrganization
    }

    return await this.prismaService.organization.create({data:{
      ...data,
      type:OrganizationType[data.type as keyof typeof OrganizationType],
      owner_id
    }})
  }

  async findAll() {
    return await this.prismaService.organization.findMany()
  }

  async findOne(id: string) {
    return await this.prismaService.organization.findUnique({where:{id}})
  }

  async update(id: string, data: UpdateOrganizationDto) {
    return await this.prismaService.organization.update({data,where:{id}})
  }

  async updateIsActive(owner_id:string,isActive:boolean){
    return await this.prismaService.organization.update({where:{owner_id},data:{isActive}})
  }

  async delete(id: string) {
    return await this.prismaService.organization.delete({where:{id}})
  }
}
