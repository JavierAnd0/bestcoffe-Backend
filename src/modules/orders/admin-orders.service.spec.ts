import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { AdminOrdersService } from './admin-orders.service';
import { OrderSettlementService } from './order-settlement.service';

/** Marcar un pedido como pagado a mano (transferencia / contra entrega). */
describe('AdminOrdersService.update — pago manual', () => {
  let prisma: {
    order: { findFirst: jest.Mock; update: jest.Mock };
  };
  let settlement: { settlePaidOrder: jest.Mock };
  let service: AdminOrdersService;

  const orderState = (status: string, paymentStatus: string) =>
    prisma.order.findFirst.mockResolvedValue({
      id: 'o1',
      status,
      paymentStatus,
    });
  const markPaid = () => service.update('t1', 'o1', { paymentStatus: 'PAID' });

  beforeEach(() => {
    prisma = {
      order: {
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 'o1' }),
      },
    };
    settlement = {
      settlePaidOrder: jest.fn().mockResolvedValue({ settled: true }),
    };
    service = new AdminOrdersService(
      prisma as unknown as PrismaService,
      {} as MailService,
      settlement as unknown as OrderSettlementService,
    );
  });

  it.each([
    ['RECEIVED', 'PENDING'],
    ['PREPARING', 'FAILED'],
  ])(
    'un pedido %s con pago %s se liquida (stock, cupón, correo)',
    async (status, payment) => {
      orderState(status, payment);
      await markPaid();
      expect(settlement.settlePaidOrder).toHaveBeenCalledWith('o1', {
        provider: 'MANUAL',
      });
    },
  );

  it('rechaza marcar pagado un pedido cancelado: ya devolvió su stock', async () => {
    orderState('CANCELLED', 'PENDING');
    await expect(markPaid()).rejects.toMatchObject({ status: 400 });
    expect(settlement.settlePaidOrder).not.toHaveBeenCalled();
  });

  it('rechaza marcar pagado un pedido reembolsado: ya descontó su stock', async () => {
    orderState('DELIVERED', 'REFUNDED');
    await expect(markPaid()).rejects.toMatchObject({ status: 400 });
    expect(settlement.settlePaidOrder).not.toHaveBeenCalled();
  });

  it('otros cambios de pago no pasan por la liquidación', async () => {
    orderState('RECEIVED', 'PENDING');
    await service.update('t1', 'o1', {
      paymentStatus: 'FAILED',
    });
    expect(settlement.settlePaidOrder).not.toHaveBeenCalled();
  });
});
