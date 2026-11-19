import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../prisma/prisma.service';
import type { OrderSettlementService } from '../orders/order-settlement.service';
import { deriveSecretBoxKey, seal } from '../../common/crypto/secret-box';
import {
  EpaycoService,
  epaycoBilling,
  epaycoSignature,
  mapEpaycoState,
  type EpaycoTransaction,
} from './epayco.service';

const CUST = '123456';
const PKEY = 'pkeysecreta0001';
const key = deriveSecretBoxKey();

function tenant(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tenant_1',
    epaycoCustomerId: CUST,
    epaycoPKey: seal(PKEY, key),
    epaycoPublicKey: 'pub',
    epaycoPrivateKey: seal('priv', key),
    epaycoTest: true,
    epaycoConnected: true,
    ...overrides,
  };
}

function signed(tx: EpaycoTransaction, pKey = PKEY): EpaycoTransaction {
  return { ...tx, x_signature: epaycoSignature(CUST, pKey, tx) };
}

const baseTx: EpaycoTransaction = {
  x_ref_payco: '9001',
  x_transaction_id: 'tx-1',
  x_id_invoice: 'order_1',
  x_cust_id_cliente: CUST,
  x_amount: '50000',
  x_currency_code: 'COP',
  x_response: 'Aceptada',
  x_test_request: 'TRUE',
};

function setup(
  opts: { tenant?: ReturnType<typeof tenant>; total?: number } = {},
) {
  const order = {
    id: 'order_1',
    totalCents: opts.total ?? 5_000_000,
    tenant: opts.tenant ?? tenant(),
  };
  const prisma = {
    order: {
      findUnique: jest.fn(({ select }: { select: Record<string, unknown> }) =>
        Promise.resolve(
          select.paymentStatus ? { paymentStatus: 'PENDING' } : order,
        ),
      ),
      findFirst: jest.fn().mockResolvedValue(order),
      findMany: jest
        .fn()
        .mockResolvedValue([
          { ...order, epaycoRef: '6aff27ba9112494bdcc7e61a' },
        ]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const settlement = {
    settlePaidOrder: jest.fn().mockResolvedValue({ settled: true }),
  };
  const service = new EpaycoService(
    prisma as unknown as PrismaService,
    { get: jest.fn() } as unknown as ConfigService,
    settlement as unknown as OrderSettlementService,
  );
  const fetchTx = jest.spyOn(service, 'fetchTransaction');
  return { service, prisma, settlement, fetchTx };
}

describe('EpaycoService confirmation', () => {
  it('liquida una transacción aceptada, firmada y del monto exacto', async () => {
    const { service, settlement, fetchTx } = setup();
    fetchTx.mockResolvedValue(signed(baseTx));
    await service.handleConfirmation({ x_ref_payco: '9001' });
    expect(settlement.settlePaidOrder).toHaveBeenCalledWith('order_1', {
      provider: 'EPAYCO',
      eventId: '9001',
      eventType: 'transaction.accepted',
      epaycoRef: '9001',
    });
  });

  it('consulta a ePayco y no confía en el cuerpo del aviso', async () => {
    const { service, settlement, fetchTx } = setup();
    fetchTx.mockResolvedValue(signed({ ...baseTx, x_response: 'Rechazada' }));
    // El aviso dice "Aceptada", pero ePayco dice "Rechazada".
    await service.handleConfirmation({
      x_ref_payco: '9001',
      x_response: 'Aceptada',
    });
    expect(fetchTx).toHaveBeenCalledWith('9001');
    expect(settlement.settlePaidOrder).not.toHaveBeenCalled();
  });

  it.each([
    ['firma con otra P_KEY', signed(baseTx, 'otra-llave')],
    ['otro comercio', signed({ ...baseTx, x_cust_id_cliente: '999' })],
    ['monto distinto', signed({ ...baseTx, x_amount: '100' })],
    ['otra moneda', signed({ ...baseTx, x_currency_code: 'USD' })],
    ['sin firma', { ...baseTx }],
  ])('rechaza: %s', async (_why, tx) => {
    const { service, settlement, prisma, fetchTx } = setup();
    fetchTx.mockResolvedValue(tx);
    await service.handleConfirmation({ ref_payco: '9001' });
    expect(settlement.settlePaidOrder).not.toHaveBeenCalled();
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
  });

  it('rechaza una transacción de prueba en una tienda en producción', async () => {
    const { service, settlement, fetchTx } = setup({
      tenant: tenant({ epaycoTest: false }),
    });
    fetchTx.mockResolvedValue(signed(baseTx));
    await service.handleConfirmation({ x_ref_payco: '9001' });
    expect(settlement.settlePaidOrder).not.toHaveBeenCalled();
  });

  it('sync no aplica una transacción de otro pedido', async () => {
    const { service, settlement, fetchTx } = setup();
    fetchTx.mockResolvedValue(signed({ ...baseTx, x_id_invoice: 'order_2' }));
    const res = await service.syncPayment('tenant_1', 'order_1', '9001');
    expect(settlement.settlePaidOrder).not.toHaveBeenCalled();
    expect(res.epaycoStatus).toBeNull();
  });

  it('un rechazo marca FAILED sin pisar un pedido ya pagado', async () => {
    const { service, prisma, fetchTx } = setup();
    fetchTx.mockResolvedValue(signed({ ...baseTx, x_response: 'Rechazada' }));
    await service.handleConfirmation({ x_ref_payco: '9001' });
    expect(prisma.order.updateMany).toHaveBeenCalledWith({
      where: { id: 'order_1', paymentStatus: { notIn: ['PAID', 'REFUNDED'] } },
      data: { paymentStatus: 'FAILED', epaycoRef: '9001' },
    });
  });

  it('consulta primero ref_payco (hex) y cae a x_ref_payco', async () => {
    const { service, settlement, fetchTx } = setup();
    // El checkout nuevo: la consulta solo reconoce la referencia hex.
    fetchTx.mockImplementation((ref: string) =>
      Promise.resolve(
        ref === '6aff27ba9112494bdcc7e61a' ? signed(baseTx) : null,
      ),
    );
    await service.handleConfirmation({
      x_ref_payco: '9001',
      ref_payco: '6aff27ba9112494bdcc7e61a',
    });
    expect(fetchTx).toHaveBeenNthCalledWith(1, '6aff27ba9112494bdcc7e61a');
    expect(settlement.settlePaidOrder).toHaveBeenCalled();
  });

  it('el evento usa la referencia canónica y el pedido guarda la consultable', async () => {
    const { service, settlement, fetchTx } = setup();
    fetchTx.mockResolvedValue(signed(baseTx)); // x_ref_payco: '9001'
    await service.syncPayment(
      'tenant_1',
      'order_1',
      '6aff27ba9112494bdcc7e61a',
    );
    expect(settlement.settlePaidOrder).toHaveBeenCalledWith(
      'order_1',
      expect.objectContaining({
        eventId: '9001',
        epaycoRef: '6aff27ba9112494bdcc7e61a',
      }),
    );
  });

  it('ignora un ref_payco con formato inválido sin consultar', async () => {
    const { service, fetchTx } = setup();
    await service.handleConfirmation({ x_ref_payco: '../../x' });
    expect(fetchTx).not.toHaveBeenCalled();
  });
});

describe('EpaycoService.reconcilePending', () => {
  it('revisa los pendientes con la referencia guardada y aplica el resultado', async () => {
    const { service, settlement, prisma, fetchTx } = setup();
    fetchTx.mockResolvedValue(signed(baseTx));
    prisma.order.findUnique.mockResolvedValue({ paymentStatus: 'PAID' });
    const res = await service.reconcilePending();
    expect(fetchTx).toHaveBeenCalledWith('6aff27ba9112494bdcc7e61a');
    expect(settlement.settlePaidOrder).toHaveBeenCalled();
    expect(res).toEqual({ checked: 1, changed: 1, errors: 0 });
  });

  it('solo busca pedidos de ePayco pendientes, recientes y de tiendas conectadas', async () => {
    const { service, prisma, fetchTx } = setup();
    fetchTx.mockResolvedValue(null);
    await service.reconcilePending();
    const [args] = prisma.order.findMany.mock.calls[0] as [
      { where: Record<string, unknown> },
    ];
    expect(args.where).toMatchObject({
      paymentStatus: 'PENDING',
      epaycoRef: { not: null },
      tenant: { epaycoConnected: true },
    });
  });

  it('un error de ePayco en un pedido no detiene la revisión', async () => {
    const { service, fetchTx } = setup();
    fetchTx.mockRejectedValue(new Error('timeout'));
    const res = await service.reconcilePending();
    expect(res).toEqual({ checked: 1, changed: 0, errors: 1 });
  });
});

describe('mapEpaycoState', () => {
  it.each([
    [{ x_response: 'Aceptada' }, 'PAID'],
    [{ x_cod_response: 1 }, 'PAID'],
    [{ x_response: 'Pendiente' }, 'PENDING'],
    [{ x_response: 'Rechazada' }, 'FAILED'],
    [{ x_response: 'Abandonada' }, 'FAILED'],
    [{ x_response: 'Reversada' }, 'REFUNDED'],
    [{ x_response: 'Iniciada' }, 'IGNORE'],
  ])('%j → %s', (tx, expected) => {
    expect(mapEpaycoState(tx)).toBe(expected);
  });
});

describe('epaycoBilling', () => {
  const customer = { email: 'ana@correo.co', name: 'Cliente' };

  it('usa lo que el comprador escribió en el checkout, no el perfil', () => {
    expect(
      epaycoBilling(customer, {
        recipientName: 'Ana Pérez',
        line1: 'Calle 8 # 1-2',
        line2: 'Apto 301',
        city: 'Bogotá',
        state: 'Cundinamarca',
        phone: '+57 300 123 4567',
      }),
    ).toEqual({
      email: 'ana@correo.co',
      name: 'Ana Pérez',
      address: 'Calle 8 # 1-2, Apto 301, Bogotá, Cundinamarca',
      callingCode: '+57',
      mobilePhone: '3001234567',
    });
  });

  it('agrega el documento del pagador cuando viene', () => {
    expect(
      epaycoBilling(customer, null, { type: 'CC', number: '1020304050' }),
    ).toEqual({
      email: 'ana@correo.co',
      name: 'Cliente',
      typeDoc: 'CC',
      numberDoc: '1020304050',
    });
  });

  it('cae al nombre del perfil y omite un teléfono inválido', () => {
    expect(epaycoBilling(customer, { line1: 'Calle 1', phone: '12' })).toEqual({
      email: 'ana@correo.co',
      name: 'Cliente',
      address: 'Calle 1',
    });
  });
});
