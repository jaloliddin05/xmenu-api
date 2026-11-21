import { Module } from '@nestjs/common';
import { PrismaModule } from '../_prisma/prisma.module';
import { TenantModule } from '../tenant/tenant.module';
import { CustomerAddressController } from './customer-address.controller';
import { CustomerController } from './customer.controller';
import { CustomerAddressRepository } from './repositories/customer-address.repository';
import { CustomerRepository } from './repositories/customer.repository';
import { CustomerAddressService } from './services/customer-address.service';
import { CustomerAnonymizerService } from './services/customer-anonymizer.service';
import { CustomerService } from './services/customer.service';

@Module({
  imports: [PrismaModule, TenantModule],
  controllers: [CustomerController, CustomerAddressController],
  providers: [
    CustomerRepository,
    CustomerService,
    CustomerAnonymizerService,
    CustomerAddressRepository,
    CustomerAddressService,
  ],
  exports: [CustomerRepository, CustomerService, CustomerAnonymizerService],
})
export class CustomerModule {}
