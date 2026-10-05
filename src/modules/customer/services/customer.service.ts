import { Injectable, NotFoundException } from '@nestjs/common';
import { CustomerRepository } from '../repositories/customer.repository';
import { UpdateCustomerDto } from '../dto';
import { normalizeCustomerName } from 'src/infra/helper/auth/customer-validators';
import { CustomerAuthException } from 'src/modules/auth/errors/customer-auth.exception';

export interface CustomerUser {
  id: string;
  phone: string;
  name: string;
}

@Injectable()
export class CustomerService {
  constructor(private readonly customerRepository: CustomerRepository) {}

  /** Frontend bilan kelishilgan yagona format: { id, phone, name } */
  toUser(c: { id: string; phone: string; name: string }): CustomerUser {
    return { id: c.id, phone: c.phone, name: c.name };
  }

  async getMe(tenantId: string, customerId: string): Promise<CustomerUser> {
    const customer = await this.customerRepository.findById(tenantId, customerId);
    if (!customer) throw new NotFoundException('Customer not found');
    if (customer.status === 'blocked') throw new CustomerAuthException('customer_blocked');
    return this.toUser(customer);
  }

  async updateMe(tenantId: string, customerId: string, dto: UpdateCustomerDto): Promise<CustomerUser> {
    const name = normalizeCustomerName(dto.name);
    if (!name) throw new CustomerAuthException('invalid_name');

    const current = await this.getMe(tenantId, customerId);
    await this.customerRepository.update(tenantId, customerId, { name });
    return { ...current, name };
  }
}
