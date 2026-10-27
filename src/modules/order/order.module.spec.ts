import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../_prisma/prisma.service';
import { BranchModule } from '../branch/branch.module';
import { MenuModule } from '../menu/menu.module';
import { PaymentModule } from '../payment/payment.module';
import { OrderModule } from './order.module';
import { OrderService } from './services/order.service';
import { OrderTransitionService } from './services/order-transition.service';
import { OrderStaffService } from './services/order-staff.service';

/**
 * Bog'lanish testi: modullar bir-birini sikl va yetishmayotgan provider'siz
 * yig'adimi (DI grafigi). DB va Redis'siz — Prisma soxta, navbatlar o'chiq.
 */
describe('order/payment/branch/menu modules wiring', () => {
  const prev = process.env.ORDER_QUEUES;
  beforeAll(() => {
    process.env.ORDER_QUEUES = 'off';
  });
  afterAll(() => {
    process.env.ORDER_QUEUES = prev;
  });

  it('resolves the whole dependency graph', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), BranchModule, MenuModule, PaymentModule, OrderModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();

    expect(moduleRef.get(OrderService)).toBeDefined();
    expect(moduleRef.get(OrderStaffService)).toBeDefined();
    expect(moduleRef.get(OrderTransitionService)).toBeDefined();
    await moduleRef.close();
  });
});
