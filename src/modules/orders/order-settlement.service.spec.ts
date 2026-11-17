import { OrderStatus } from '@prisma/client';
import { OrderSettlementService } from './order-settlement.service';
import { PrismaService } from '../../prisma/prisma.service';

const mockInngestSend = jest.fn().mockResolvedValue(undefined);

jest.mock('../inngest/inngest.client', () => ({
  inngest: {
    send: (...args: unknown[]) => mockInngestSend(...args) as unknown,
  },
}));

describe('OrderSettlementService', () => {
  let service: OrderSettlementService;
  let txMock: {
    stripeEvent: { create: jest.Mock };
    mercadoPagoEvent: { create: jest.Mock };
    order: { findUnique: jest.Mock; update: jest.Mock };
    productVariant: { updateMany: jest.Mock; update: jest.Mock };
    discountCode: { updateMany: jest.Mock };
    subscription: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
    };
  };
  let prismaMock: { $transaction: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    txMock = {
      stripeEvent: { create: jest.fn().mockResolvedValue({}) },
      mercadoPagoEvent: { create: jest.fn().mockResolvedValue({}) },
      order: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 'ord-1' }),
      },
      productVariant: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      discountCode: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      subscription: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    prismaMock = {
      $transaction: jest.fn((cb: (tx: typeof txMock) => unknown) => cb(txMock)),
    };
    service = new OrderSettlementService(
      prismaMock as unknown as PrismaService,
    );
  });

  it('settlePaidOrder: liquida una orden PENDING, descuenta stock, incrementa cupón y emite evento Inngest', async () => {
    txMock.order.findUnique.mockResolvedValue({
      id: 'ord-1',
      tenantId: 'ten-1',
      paymentStatus: 'PENDING',
      discountCode: 'CAFE10',
      items: [{ variantId: 'var-1', quantity: 2 }],
    });

    const result = await service.settlePaidOrder('ord-1', {
      provider: 'STRIPE',
      eventId: 'evt_1',
      eventType: 'payment_intent.succeeded',
      stripePaymentIntentId: 'pi_123',
    });

    expect(result).toEqual({ settled: true });
    expect(txMock.order.update).toHaveBeenCalledWith({
      where: { id: 'ord-1' },
      data: { paymentStatus: 'PAID', stripePaymentIntentId: 'pi_123' },
    });
    expect(txMock.productVariant.updateMany).toHaveBeenCalledWith({
      where: { id: 'var-1', stock: { gt: 0 } },
      data: { stock: { decrement: 2 } },
    });
    expect(txMock.discountCode.updateMany).toHaveBeenCalledWith({
      where: { tenantId: 'ten-1', code: 'CAFE10' },
      data: { timesRedeemed: { increment: 1 } },
    });
    expect(mockInngestSend).toHaveBeenCalledWith({
      name: 'order/created',
      data: { orderId: 'ord-1' },
    });
  });

  it('settlePaidOrder: doble blindaje idempotente si la orden ya estaba en PAID (no vuelve a descontar stock ni emitir evento)', async () => {
    txMock.order.findUnique.mockResolvedValue({
      id: 'ord-1',
      tenantId: 'ten-1',
      paymentStatus: 'PAID',
      discountCode: 'CAFE10',
      items: [{ variantId: 'var-1', quantity: 2 }],
    });

    const result = await service.settlePaidOrder('ord-1', {
      provider: 'MERCADOPAGO',
      eventId: 'mp_evt_2',
      eventType: 'payment.approved',
      mpPaymentId: '999',
    });

    expect(result).toEqual({ settled: false });
    expect(txMock.order.update).not.toHaveBeenCalled();
    expect(txMock.productVariant.updateMany).not.toHaveBeenCalled();
    expect(mockInngestSend).not.toHaveBeenCalled();
  });

  it('cancelOrderAndRestoreInventory: restituye stock y cupón si la orden estaba PAID', async () => {
    txMock.order.findUnique.mockResolvedValue({
      id: 'ord-1',
      tenantId: 'ten-1',
      paymentStatus: 'PAID',
      discountCode: 'CAFE10',
      items: [{ variantId: 'var-1', quantity: 3 }],
    });
    txMock.order.update.mockResolvedValue({
      id: 'ord-1',
      status: OrderStatus.CANCELLED,
    });

    await service.cancelOrderAndRestoreInventory('ord-1', {
      include: { items: true },
    });

    expect(txMock.productVariant.update).toHaveBeenCalledWith({
      where: { id: 'var-1' },
      data: { stock: { increment: 3 } },
    });
    expect(txMock.discountCode.updateMany).toHaveBeenCalledWith({
      where: {
        tenantId: 'ten-1',
        code: 'CAFE10',
        timesRedeemed: { gt: 0 },
      },
      data: { timesRedeemed: { decrement: 1 } },
    });
  });

  describe('primer pedido de una suscripción', () => {
    const subOrder = (over: Record<string, unknown> = {}) => ({
      id: 'ord-s',
      tenantId: 'ten-1',
      customerId: 'cus-1',
      source: 'CHECKOUT',
      subscriptionId: 'sub-1',
      paymentStatus: 'PENDING',
      discountCode: null,
      items: [{ variantId: 'var-1', quantity: 1 }],
      ...over,
    });

    it('al pagarse (manual) activa la suscripción que esperaba ese pago', async () => {
      txMock.order.findUnique.mockResolvedValue(subOrder());
      txMock.subscription.findMany.mockResolvedValue([
        { id: 'sub-1', variantId: 'var-1', frequencyDays: 14 },
      ]);

      const result = await service.settlePaidOrder('ord-s', {
        provider: 'MANUAL',
      });

      expect(result).toEqual({ settled: true });
      expect(txMock.subscription.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            customerId: 'cus-1',
            variantId: { in: ['var-1'] },
            status: 'PAYMENT_FAILED',
            lastShippedAt: null,
          }) as unknown,
        }),
      );
      const call = txMock.subscription.update.mock.calls[0] as [
        {
          where: unknown;
          data: { status: string; lastShippedAt: Date; nextShipAt: Date };
        },
      ];
      expect(call[0].where).toEqual({ id: 'sub-1' });
      expect(call[0].data.status).toBe('ACTIVE');
      const days =
        (call[0].data.nextShipAt.getTime() -
          call[0].data.lastShippedAt.getTime()) /
        86_400_000;
      expect(days).toBe(14);
      expect(txMock.productVariant.updateMany).toHaveBeenCalled();
    });

    it('no activa si el cliente ya tiene otra suscripción ACTIVE de esa variante', async () => {
      txMock.order.findUnique.mockResolvedValue(subOrder());
      txMock.subscription.findMany.mockResolvedValue([
        { id: 'sub-1', variantId: 'var-1', frequencyDays: 14 },
      ]);
      txMock.subscription.findFirst.mockResolvedValue({ id: 'sub-otra' });

      const result = await service.settlePaidOrder('ord-s', {
        provider: 'MANUAL',
      });

      expect(result).toEqual({ settled: true });
      expect(txMock.subscription.update).not.toHaveBeenCalled();
    });

    it('un pedido normal o una renovación no toca suscripciones', async () => {
      txMock.order.findUnique.mockResolvedValue(
        subOrder({ source: 'SUBSCRIPTION_RENEWAL' }),
      );
      await service.settlePaidOrder('ord-s', { provider: 'MANUAL' });
      txMock.order.findUnique.mockResolvedValue(
        subOrder({ subscriptionId: null }),
      );
      await service.settlePaidOrder('ord-s', { provider: 'MANUAL' });

      expect(txMock.subscription.findMany).not.toHaveBeenCalled();
    });

    it('cancelar el primer pedido sin pagar cancela la suscripción pendiente', async () => {
      txMock.order.findUnique.mockResolvedValue(subOrder());
      txMock.subscription.findMany.mockResolvedValue([
        { id: 'sub-1', variantId: 'var-1' },
      ]);
      (txMock.order as unknown as { findFirst: jest.Mock }).findFirst = jest
        .fn()
        .mockResolvedValue(null);

      await service.cancelOrderAndRestoreInventory('ord-s', {
        include: { items: true },
      });

      expect(txMock.productVariant.update).not.toHaveBeenCalled();
      expect(txMock.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: { status: 'CANCELLED' },
      });
    });

    it('no la cancela si otro pedido abierto espera el pago de esa suscripción', async () => {
      txMock.order.findUnique.mockResolvedValue(subOrder());
      txMock.subscription.findMany.mockResolvedValue([
        { id: 'sub-1', variantId: 'var-1' },
      ]);
      (txMock.order as unknown as { findFirst: jest.Mock }).findFirst = jest
        .fn()
        .mockResolvedValue({ id: 'ord-otro' });

      await service.cancelOrderAndRestoreInventory('ord-s', {
        include: { items: true },
      });

      expect(txMock.subscription.update).not.toHaveBeenCalled();
    });
  });
});
