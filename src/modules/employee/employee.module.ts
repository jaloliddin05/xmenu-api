import { Module } from '@nestjs/common';
// import { EmployeeService } from './services/employee.service';
// import { EmployeeController } from './employee.controller';
import { PrismaModule } from '../_prisma/prisma.module';

@Module({
  imports:[PrismaModule],
//   controllers: [EmployeeController],
//   providers: [EmployeeService],
//   exports:[EmployeeService]
})
export class EmployeeModule {}
