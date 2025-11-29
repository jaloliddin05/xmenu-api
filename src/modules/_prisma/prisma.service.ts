import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor() {
    super({
      // adapter: "postgresql",
      datasourceUrl: process.env.DATABASE_URL,  // 👈 URL передаём сюда
    });
  }
  async onModuleInit() {
    await this.$connect();
  }
}