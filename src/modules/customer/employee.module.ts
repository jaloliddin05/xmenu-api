import { Module } from '@nestjs/common';
import { PrismaModule } from '../_prisma/prisma.module';
import { CustomerController } from './customer.controller';
import { CustomerRepository } from './repositories/customer.repository';
import { CustomerService } from './services/customer.service';

@Module({
  imports:[PrismaModule],
  controllers: [CustomerController],
  providers: [CustomerRepository,CustomerService],
  exports:[CustomerRepository,CustomerService]
})
export class CustomerModule {}
