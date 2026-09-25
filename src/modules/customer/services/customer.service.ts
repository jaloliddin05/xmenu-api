import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { CustomerRepository } from '../repositories/customer.repository';
import { UpdateCustomerDto } from '../dto';

@Injectable()
export class CustomerService {
  constructor(
    private readonly customerRepository: CustomerRepository,
  ) {}

  async getMe(customerId: string) {
    const customer =
      await this.customerRepository.findById(customerId);

    if (!customer) {
      throw new NotFoundException(
        'Customer not found',
      );
    }

    return customer;
  }

  async updateMe(
    customerId: string,
    dto: UpdateCustomerDto,
  ) {
    const customer =
      await this.customerRepository.findById(customerId);

    if (!customer) {
      throw new NotFoundException(
        'Customer not found',
      );
    }

    return this.customerRepository.update(
      customerId,
      dto,
    );
  }
}