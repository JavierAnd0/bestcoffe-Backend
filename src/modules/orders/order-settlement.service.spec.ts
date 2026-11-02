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
});

