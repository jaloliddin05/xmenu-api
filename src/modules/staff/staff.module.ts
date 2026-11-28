import { Module } from '@nestjs/common';
import { PrismaModule } from '../_prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { PushModule } from '../push/push.module';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';

@Module({
  imports: [PrismaModule, AuthModule, PushModule],
  controllers: [StaffController],
  providers: [StaffService],
})
export class StaffModule {}
