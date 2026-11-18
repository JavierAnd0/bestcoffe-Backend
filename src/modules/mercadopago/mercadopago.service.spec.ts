import { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import { MercadoPagoService } from './mercadopago.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { OrderSettlementService } from '../orders/order-settlement.service';

const preferenceCreate = jest.fn();
const paymentGet = jest.fn();
const oauthCreate = jest.fn();
jest.mock('mercadopago', () => ({
  MercadoPagoConfig: jest.fn(),
  OAuth: jest.fn().mockImplementation(() => ({ create: oauthCreate })),
  Payment: jest.fn().mockImplementation(() => ({ get: paymentGet })),
  Preference: jest
    .fn()
    .mockImplementation(() => ({ create: preferenceCreate })),
}));

const FUTURE = new Date(Date.now() + 3_600_000);

function orderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order_1',
    tenantId: 'tenant_1',
    totalCents: 4_500_000, // $45.000
    tenant: {
      id: 'tenant_1',
      name: 'Café de Especialidad del Huila',
      // Texto plano: `open` lo acepta por compatibilidad (tokens antiguos).
      mpAccessToken: 'APP_USR-token',
      mpRefreshToken: 'refresh',
      mpTokenExpiresAt: FUTURE,
      billingType: 'COMMISSION',
      commissionPct: 5,
    },
    customer: { email: 'ana@correo.com', name: 'Ana' },
    ...overrides,
  };
}

function build(prismaOverrides: Record<string, unknown> = {}) {
  const prisma = {
    order: {
      findUnique: jest.fn().mockResolvedValue(orderRow()),
      findFirst: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    tenant: {
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
    },
    tenantDomain: { findFirst: jest.fn().mockResolvedValue(null) },
    ...prismaOverrides,
  };
  const settlement = { settlePaidOrder: jest.fn() };
  const config = new ConfigService({
    webAppUrl: 'https://bestcoffee.app',
    nodeEnv: 'production',
    mercadopago: { webhookSecret: '' },
  });
  const svc = new MercadoPagoService(
    prisma as unknown as PrismaService,
    config,
    {} as JwtService,
    settlement as unknown as OrderSettlementService,
  );
  return { svc, prisma, settlement };
}

/** Cuerpo de la llamada n.º `i` a `Preference.create`, tipado. */
function prefCall(i = 0) {
  const calls = preferenceCreate.mock.calls as Array<
    [{ body: Record<string, unknown>; requestOptions: unknown }]
  >;
  return calls[i][0];
}

beforeEach(() => {
  preferenceCreate.mockReset();
  preferenceCreate.mockResolvedValue({
    id: 'pref_1',
    init_point:
      'https://www.mercadopago.com.co/checkout/v1/redirect?pref_id=pref_1',
  });
  paymentGet.mockReset();
});

describe('MercadoPagoService.createPreference', () => {
  it('cobra el total en pesos, con la comisión de la tienda y regreso a la confirmación', async () => {
    const { svc } = build();

    const out = await svc.createPreference('order_1');

    const { body, requestOptions } = prefCall();
    expect(body).toMatchObject({
      items: [
        {
          id: 'order_1',
          quantity: 1,
          unit_price: 45_000, // centavos / 100
          currency_id: 'COP',
        },
      ],
      payer: { email: 'ana@correo.com' },
      external_reference: 'order_1',
      marketplace_fee: 2_250, // 5 % de 45.000
      auto_return: 'approved',
      statement_descriptor: 'Café de Especialidad d', // 22 caracteres
      back_urls: {
        success:
          'https://bestcoffee.app/checkout/confirmacion?orderId=order_1&pago=aprobado',
        pending:
          'https://bestcoffee.app/checkout/confirmacion?orderId=order_1&pago=pendiente',
        failure:
          'https://bestcoffee.app/checkout/confirmacion?orderId=order_1&pago=fallido',
      },
    });
    expect(requestOptions).toEqual({ idempotencyKey: 'pref-order_1' });
    expect(out).toEqual({
      preferenceId: 'pref_1',
      checkoutUrl:
        'https://www.mercadopago.com.co/checkout/v1/redirect?pref_id=pref_1',
    });
  });

  it('sin comisión no envía marketplace_fee', async () => {
    const { svc, prisma } = build();
    prisma.order.findUnique.mockResolvedValue(
      orderRow({
        tenant: {
          ...orderRow().tenant,
          billingType: 'SUBSCRIPTION',
          commissionPct: null,
        },
      }),
    );
    await svc.createPreference('order_1');
    expect(prefCall().body.marketplace_fee).toBeUndefined();
  });

  it('vuelve al dominio verificado de la tienda, no a uno cualquiera', async () => {
    const { svc, prisma } = build();

    prisma.tenantDomain.findFirst.mockResolvedValueOnce({ id: 'd1' });
    await svc.createPreference('order_1', {
      returnOrigin: 'https://cafeneiva.com/cualquier/ruta',
    });
    expect((prefCall(0).body.back_urls as { success: string }).success).toMatch(
      /^https:\/\/cafeneiva\.com\/checkout\/confirmacion\?/,
    );

    prisma.tenantDomain.findFirst.mockResolvedValueOnce(null);
    await svc.createPreference('order_1', {
      returnOrigin: 'https://atacante.com',
    });
    expect((prefCall(1).body.back_urls as { success: string }).success).toMatch(
      /^https:\/\/bestcoffee\.app\//,
    );
  });

  it('sin URL HTTPS de regreso no pide auto_return (MercadoPago lo rechazaría)', async () => {
    const { svc } = build();
    const local = new MercadoPagoService(
      (svc as unknown as { prisma: PrismaService }).prisma,
      new ConfigService({
        webAppUrl: 'http://localhost:3000',
        nodeEnv: 'development',
        mercadopago: {},
      }),
      {} as JwtService,
      { settlePaidOrder: jest.fn() } as unknown as OrderSettlementService,
    );
    await local.createPreference('order_1');
    expect(prefCall().body.auto_return).toBeUndefined();
  });
});

describe('MercadoPagoService.syncPayment', () => {
  const tenant = {
    id: 'tenant_1',
    mpAccessToken: 'APP_USR-token',
    mpRefreshToken: 'refresh',
    mpTokenExpiresAt: FUTURE,
  };

  it('al volver con un pago aprobado, liquida el pedido sin esperar el webhook', async () => {
    const { svc, prisma, settlement } = build();
    prisma.order.findFirst.mockResolvedValue({ id: 'order_1', tenant });
    prisma.order.findUnique.mockResolvedValue({ paymentStatus: 'PAID' });
    paymentGet.mockResolvedValue({
      id: 777,
      status: 'approved',
      status_detail: 'accredited',
      external_reference: 'order_1',
    });

    const out = await svc.syncPayment('tenant_1', 'order_1', '777');

    expect(prisma.order.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'order_1', tenantId: 'tenant_1' },
      }),
    );
    expect(settlement.settlePaidOrder).toHaveBeenCalledWith(
      'order_1',
      expect.objectContaining({ mpPaymentId: '777' }),
    );
    expect(out).toEqual({ paymentStatus: 'PAID', mpStatus: 'approved' });
  });

  it('ignora un pago de otro pedido', async () => {
    const { svc, prisma, settlement } = build();
    prisma.order.findFirst.mockResolvedValue({ id: 'order_1', tenant });
    prisma.order.findUnique.mockResolvedValue({ paymentStatus: 'PENDING' });
    paymentGet.mockResolvedValue({
      id: 8,
      status: 'approved',
      status_detail: 'accredited',
      external_reference: 'order_2',
    });

    const out = await svc.syncPayment('tenant_1', 'order_1', '8');
    expect(settlement.settlePaidOrder).not.toHaveBeenCalled();
    expect(out).toEqual({ paymentStatus: 'PENDING', mpStatus: null });
  });

  it('un pedido de otra tienda no se consulta', async () => {
    const { svc } = build();
    const out = await svc.syncPayment('tenant_x', 'order_1', '9');
    expect(paymentGet).not.toHaveBeenCalled();
    expect(out).toEqual({ paymentStatus: null, mpStatus: null });
  });

  it('un rechazo deja el pedido pendiente (se puede reintentar en MercadoPago)', async () => {
    const { svc, prisma } = build();
    prisma.order.findFirst.mockResolvedValue({ id: 'order_1', tenant });
    prisma.order.findUnique.mockResolvedValue({ paymentStatus: 'PENDING' });
    paymentGet.mockResolvedValue({
      id: 10,
      status: 'rejected',
      status_detail: 'cc_rejected_other_reason',
      external_reference: 'order_1',
    });

    const out = await svc.syncPayment('tenant_1', 'order_1', '10');
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
    expect(out).toEqual({ paymentStatus: 'PENDING', mpStatus: 'rejected' });
  });
});

describe('MercadoPagoService.handleWebhook', () => {
  // Firma desactivada en estas pruebas: se sustituye la verificación.
  function webhookSvc(prismaOverrides: Record<string, unknown> = {}) {
    const built = build(prismaOverrides);
    jest
      .spyOn(
        built.svc as unknown as { verifySignature: () => boolean },
        'verifySignature',
      )
      .mockReturnValue(true);
    return built;
  }

  it('si el aviso llega antes que el id del pago, halla la orden por el vendedor y external_reference', async () => {
    const { svc, prisma, settlement } = webhookSvc();
    prisma.tenant.findFirst.mockResolvedValue({
      id: 'tenant_1',
      mpAccessToken: 'APP_USR-token',
      mpRefreshToken: 'refresh',
      mpTokenExpiresAt: FUTURE,
    });
    // 1.ª búsqueda (por mpPaymentId) vacía; 2.ª (id + tienda) encuentra.
    prisma.order.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'order_1' });
    paymentGet.mockResolvedValue({
      id: 333,
      status: 'approved',
      status_detail: 'accredited',
      external_reference: 'order_1',
    });

    await svc.handleWebhook(
      { type: 'payment', 'data.id': '333' },
      {},
      { type: 'payment', data: { id: '333' }, user_id: 987 },
    );

    expect(prisma.tenant.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { mpUserId: '987', mpConnected: true },
      }),
    );
    expect(prisma.order.findFirst).toHaveBeenLastCalledWith({
      where: { id: 'order_1', tenantId: 'tenant_1' },
      select: { id: true },
    });
    expect(settlement.settlePaidOrder).toHaveBeenCalledWith(
      'order_1',
      expect.objectContaining({ mpPaymentId: '333' }),
    );
  });

  it('ignora un pago cuya referencia no es de esa tienda', async () => {
    const { svc, prisma, settlement } = webhookSvc();
    prisma.tenant.findFirst.mockResolvedValue({
      id: 'tenant_1',
      mpAccessToken: 'APP_USR-token',
      mpRefreshToken: 'refresh',
      mpTokenExpiresAt: FUTURE,
    });
    prisma.order.findFirst.mockResolvedValue(null);
    paymentGet.mockResolvedValue({
      id: 4,
      status: 'approved',
      status_detail: 'accredited',
      external_reference: 'order_de_otra_tienda',
    });

    await svc.handleWebhook(
      { type: 'payment', 'data.id': '4' },
      {},
      { user_id: 987 },
    );
    expect(settlement.settlePaidOrder).not.toHaveBeenCalled();
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
  });

  it('un reembolso sí puede pasar sobre un pedido pagado', async () => {
    const { svc, prisma } = webhookSvc();
    prisma.order.findFirst.mockResolvedValue({
      id: 'order_1',
      tenant: {
        id: 'tenant_1',
        mpAccessToken: 'APP_USR-token',
        mpRefreshToken: 'refresh',
        mpTokenExpiresAt: FUTURE,
      },
    });
    paymentGet.mockResolvedValue({
      id: 5,
      status: 'refunded',
      status_detail: 'refunded',
    });

    await svc.handleWebhook({ type: 'payment', 'data.id': '5' }, {}, undefined);
    expect(prisma.order.updateMany).toHaveBeenCalledWith({
      where: { id: 'order_1' },
      data: { paymentStatus: 'REFUNDED', mpPaymentId: '5' },
    });
  });
});

describe('MercadoPagoService.exchangeCodeAndStore', () => {
  it('conectar la cuenta deja MercadoPago como pasarela de la tienda', async () => {
    oauthCreate.mockResolvedValue({
      access_token: 'APP_USR-a',
      refresh_token: 'r',
      user_id: 987,
      public_key: 'APP_USR-pk',
      expires_in: 15_552_000,
    });
    const { svc, prisma } = build();
    await svc.exchangeCodeAndStore('tenant_1', 'code');
    const [arg] = prisma.tenant.update.mock.calls[0] as [
      { where: unknown; data: Record<string, unknown> },
    ];
    expect(arg.where).toEqual({ id: 'tenant_1' });
    expect(arg.data).toMatchObject({
      mpConnected: true,
      mpUserId: '987',
      mpPublicKey: 'APP_USR-pk',
      paymentProvider: 'MERCADOPAGO',
    });
  });
});
