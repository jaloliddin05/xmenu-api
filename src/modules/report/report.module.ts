import { Module } from '@nestjs/common';
import { PrismaModule } from '../_prisma/prisma.module';
import { ReportController } from './report.controller';
import { ReportService } from './report.service';

/** Delivery reports for the owner (docs/DELIVERY.md, "Отчёты"): couriers, external services, problems. */
@Module({
  imports: [PrismaModule],
  controllers: [ReportController],
  providers: [ReportService],
})
export class ReportModule {}
