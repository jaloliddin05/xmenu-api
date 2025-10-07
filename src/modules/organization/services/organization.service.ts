import { Injectable } from '@nestjs/common';
import { OrganizationType } from '@prisma/client';


import { PrismaService } from '../../_prisma/prisma.service';
import { CreateOrganizationDto } from '../dto';
import { FileService } from 'src/modules/file/file.service';
import UpdateOrganizationDto from '../dto/update-organization.dto';

@Injectable()
export class OrganizationService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly fileService: FileService
  ) { }

  async create(data: CreateOrganizationDto, owner_id: string) {
    const organization = await this.prismaService.organization.findUnique({ where: { owner_id } })

    if (organization) {
      const updatedOrganization = await this.prismaService.organization.update({ where: { id: organization.id }, data: { ...data, type: OrganizationType[data.type as keyof typeof OrganizationType] } })
      return updatedOrganization
    }

    return await this.prismaService.organization.create({
      data: {
        ...data,
        type: OrganizationType[data.type as keyof typeof OrganizationType],
        owner_id
      }
    })
  }

  async findAll() {
    return await this.prismaService.organization.findMany()
  }

  async findOne(id: string) {
    return await this.prismaService.organization.findUnique({ where: { id } })
  }

  async findById(id: string) {
    const organization = await this.prismaService.organization.findUnique({
      where: { id }, include: {
        logo: true,
        banner: true
      }
    })
    return organization
  }

  async update(id: string, data: UpdateOrganizationDto, logo?: Express.Multer.File, banner?: Express.Multer.File) {
    const files:any = {}
     if (logo) {
      const newAvatar = await this.updateImage(logo,id,'logo');
      files.logo_id = newAvatar.id;
    }

    if (banner) {
      const newAvatar = await this.updateImage(banner,id,'banner');
      files.banner_id = newAvatar.id;
    }

    if(data.type){
      data.type = OrganizationType[data.type as keyof typeof OrganizationType]
    }

    return await this.prismaService.organization.update({
      where: { id },
      data:{ ...data, ...files },
      include: { logo: true , banner: true},
    });
  }

  async updateIsActive(owner_id: string, isActive: boolean) {
    return await this.prismaService.organization.update({ where: { owner_id }, data: { isActive } })
  }

  async delete(id: string) {
    return await this.prismaService.organization.delete({ where: { id } })
  }

  async updateImage(file: Express.Multer.File, id: string,type:'logo'|'banner') {
    const data = await this.findById(id);
    const avatar = await this.fileService.updateFile(data?.[type]?.id || '', file);
    return avatar;
  }

  async deleteImage(id: string,type) {
    const data = await this.findById(id);
    if (data?.[type]?.url) {
      await this.fileService.removeFile(data?.[type].id);
    }
  }
}
