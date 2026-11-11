import { Injectable } from '@nestjs/common';
import { CustomerRepository } from '../repositories/customer.repository';
import { UpdateCustomerDto } from '../dto';
import { normalizeCustomerName } from 'src/infra/helper/auth/customer-validators';
import { isLang, type Lang } from 'src/infra/http/request-helpers';
import { AppException } from 'src/infra/errors/app-exception';

export interface CustomerUser {
  id: string;
  phone: string;
  name: string;
  language: string | null;
}

@Injectable()
export class CustomerService {
  constructor(private readonly customerRepository: CustomerRepository) {}

  /** Frontend bilan kelishilgan yagona format: { id, phone, name, language } */
  toUser(c: {
    id: string;
    phone: string;
    name: string;
    language?: string | null;
  }): CustomerUser {
    return {
      id: c.id,
      phone: c.phone,
      name: c.name,
      language: c.language ?? null,
    };
  }

  async getMe(tenantId: string, customerId: string): Promise<CustomerUser> {
    const customer = await this.customerRepository.findById(
      tenantId,
      customerId,
    );
    if (!customer)
      throw new AppException('not_found', { message: 'Customer not found' });
    if (customer.status === 'blocked')
      throw new AppException('customer_blocked');
    return this.toUser(customer);
  }

  async updateMe(
    tenantId: string,
    customerId: string,
    dto: UpdateCustomerDto,
    venueLanguages: readonly Lang[],
  ): Promise<CustomerUser> {
    if (dto.name === undefined && dto.language === undefined)
      throw new AppException('validation_error', {
        fields: [
          {
            field: 'name',
            code: 'required',
            message: 'Send name or language',
          },
        ],
      });

    const data: { name?: string; language?: Lang } = {};
    if (dto.name !== undefined) {
      const name = normalizeCustomerName(dto.name);
      if (!name) throw new AppException('invalid_name');
      data.name = name;
    }
    if (dto.language !== undefined) {
      if (!isLang(dto.language) || !venueLanguages.includes(dto.language))
        throw new AppException('language_not_supported');
      data.language = dto.language;
    }

    const current = await this.getMe(tenantId, customerId);
    await this.customerRepository.update(tenantId, customerId, data);
    return { ...current, ...data };
  }
}
