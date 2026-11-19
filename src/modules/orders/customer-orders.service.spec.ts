import type { PrismaService } from '../../prisma/prisma.service';
import { CustomerOrdersService } from './customer-orders.service';

describe('CustomerOrdersService.findOne', () => {
  it('no expone al cliente las notas internas ni los ids de las pasarelas', async () => {
    const prisma = {
      order: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'order_1',
          tenantId: 'tenant_1',
          status: 'SHIPPED',
          paymentStatus: 'PAID',
          trackingUrl: 'https://rastreo.example/123',
          internalNotes: 'cliente difícil, revisar dirección',
          stripePaymentIntentId: 'pi_123',
          mpPaymentId: '987',
          epaycoRef: '6aff27ba9112494bdcc7e61a',
          items: [],
        }),
      },
      productVariant: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new CustomerOrdersService(
      prisma as unknown as PrismaService,
    );

    const order = await service.findOne('customer_1', 'order_1');

    expect(order).toMatchObject({
      id: 'order_1',
      paymentStatus: 'PAID',
      trackingUrl: 'https://rastreo.example/123',
    });
    for (const hidden of [
      'internalNotes',
      'stripePaymentIntentId',
      'mpPaymentId',
      'epaycoRef',
    ]) {
      expect(order).not.toHaveProperty(hidden);
    }
  });
});
