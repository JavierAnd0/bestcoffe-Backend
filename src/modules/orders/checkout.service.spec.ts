import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CheckoutService } from './checkout.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CartService } from '../cart/cart.service';
import { StripeService } from '../stripe/stripe.service';
import { MercadoPagoService } from '../mercadopago/mercadopago.service';
import { PurchaseMode } from '../cart/dto/price-cart.dto';
import { TenantFeaturesService } from '../../common/features/tenant-features.service';
import type { CreateGuestOrderDto } from './dto/create-order.dto';

/**
 * Pedido de invitado: el correo no está verificado, así que este camino nunca
 * debe entregar una sesión, alterar una cuenta real ni colgarse de ella.
 */
describe('CheckoutService.createGuest', () => {
  let service: CheckoutService;
  let prisma: {
    customer: { findUnique: jest.Mock; upsert: jest.Mock; update: jest.Mock };
  };
  let createSpy: jest.SpyInstance;

  const dto = (
    over: Partial<CreateGuestOrderDto> = {},
  ): CreateGuestOrderDto => ({
    email: '  Cliente@Cafe.CO ',
    name: 'Ana Pérez',
    items: [{ variantId: 'v1', quantity: 1 }],
    mode: PurchaseMode.ONE_TIME,
    shippingAddress: { line1: 'Calle 1', city: 'Bogotá', country: 'CO' },
    ...over,
  });

  beforeEach(() => {
    prisma = {
      customer: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({ id: 'cust-1' }),
        update: jest.fn(),
      },
    };
    service = new CheckoutService(
      prisma as unknown as PrismaService,
      {} as CartService,
      {} as StripeService,
      {} as MercadoPagoService,
      {} as ConfigService,
      {} as TenantFeaturesService,
    );
    createSpy = jest
      .spyOn(service, 'create')
      .mockResolvedValue({ orderId: 'order-1' } as never);
  });

  it('un correo ya usado solo como invitado se reutiliza sin modificarlo', async () => {
    prisma.customer.findUnique.mockResolvedValue({
      passwordHash: null,
      emailVerified: false,
    });

    const result = await service.createGuest('tenant-1', dto());

    expect(prisma.customer.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: {} }),
    );
    expect(prisma.customer.update).not.toHaveBeenCalled();
    expect(createSpy).toHaveBeenCalledWith(
      'tenant-1',
      'cust-1',
      expect.anything(),
      { guest: true },
    );
    expect(result).toEqual({ orderId: 'order-1' });
  });

  it('crea el cliente con el correo normalizado y sin marcarlo verificado', async () => {
    await service.createGuest('tenant-1', dto());

    const call = prisma.customer.upsert.mock.calls[0] as [
      {
        where: unknown;
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      },
    ];
    expect(call[0].where).toEqual({
      tenantId_email: { tenantId: 'tenant-1', email: 'cliente@cafe.co' },
    });
    expect(call[0].create).toEqual({
      tenantId: 'tenant-1',
      email: 'cliente@cafe.co',
      name: 'Ana Pérez',
    });
    expect(call[0].create).not.toHaveProperty('emailVerified');
  });

  it.each([
    ['con contraseña', { passwordHash: 'hash', emailVerified: false }],
    ['verificada (Google)', { passwordHash: null, emailVerified: true }],
  ])(
    'rechaza (409) un correo de una cuenta real %s: debe iniciar sesión',
    async (_label, account) => {
      prisma.customer.findUnique.mockResolvedValue(account);

      await expect(
        service.createGuest('tenant-1', dto()),
      ).rejects.toMatchObject({ status: 409 });
      expect(prisma.customer.upsert).not.toHaveBeenCalled();
      expect(createSpy).not.toHaveBeenCalled();
    },
  );

  it('nunca devuelve un token ni datos de sesión', async () => {
    const result = (await service.createGuest('tenant-1', dto())) as Record<
      string,
      unknown
    >;

    expect(result).not.toHaveProperty('accessToken');
    expect(result).not.toHaveProperty('token');
  });

  it('rechaza suscripciones: requieren una cuenta propia', async () => {
    await expect(
      service.createGuest('tenant-1', dto({ mode: PurchaseMode.SUBSCRIPTION })),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.customer.findUnique).not.toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();
  });
});

/**
 * Tienda con pedidos pero sin pagos en línea: la orden se crea y queda
 * pendiente; no se toca ninguna pasarela.
 */
describe('CheckoutService.create sin pagos en línea', () => {
  const order = { id: 'order-9', totalCents: 5_000_00 };
  const priced = {
    hasStockIssues: false,
    lines: [
      {
        variantId: 'v1',
        productName: 'Café',
        sizeGrams: 250,
        grind: 'WHOLE_BEAN',
        unitCents: 5_000_00,
        quantity: 1,
        lineCents: 5_000_00,
      },
    ],
    subtotalCents: 5_000_00,
    discountCents: 0,
    shippingCents: 0,
    totalCents: 5_000_00,
    discount: undefined,
  };

  const build = (onlinePayments: boolean, stripeEnabled = true) => {
    const stripe = { createPaymentIntent: jest.fn() };
    const mercadopago = { createPayment: jest.fn() };
    const tx = {
      cartItem: { deleteMany: jest.fn() },
      order: { create: jest.fn().mockResolvedValue(order) },
    };
    const prisma = {
      tenant: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ paymentProvider: 'STRIPE', mpConnected: false }),
      },
      order: { update: jest.fn() },
      $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    const service = new CheckoutService(
      prisma as unknown as PrismaService,
      { price: jest.fn().mockResolvedValue(priced) } as unknown as CartService,
      stripe as unknown as StripeService,
      mercadopago as unknown as MercadoPagoService,
      {
        get: jest.fn().mockReturnValue(stripeEnabled),
      } as unknown as ConfigService,
      {
        get: jest.fn().mockResolvedValue({ onlinePayments }),
      } as unknown as TenantFeaturesService,
    );
    return { service, stripe, mercadopago, prisma };
  };

  const dto = {
    items: [{ variantId: 'v1', quantity: 1 }],
    mode: PurchaseMode.ONE_TIME,
    shippingAddress: { line1: 'Calle 1', city: 'Bogotá', country: 'CO' },
  } as never;

  it('crea el pedido pendiente y no llama a ninguna pasarela', async () => {
    const { service, stripe, mercadopago } = build(false);

    const result = await service.create('tenant-1', 'cust-1', dto);

    expect(result).toMatchObject({
      orderId: 'order-9',
      provider: 'MANUAL',
      paymentStatus: 'PENDING',
    });
    expect(stripe.createPaymentIntent).not.toHaveBeenCalled();
    expect(mercadopago.createPayment).not.toHaveBeenCalled();
  });

  it('con pagos en línea sí cobra con la pasarela de la tienda', async () => {
    const { service, stripe } = build(true);
    stripe.createPaymentIntent.mockResolvedValue({
      clientSecret: 'cs',
      piId: 'pi_1',
    });

    const result = await service.create('tenant-1', 'cust-1', dto);

    expect(result).toMatchObject({ provider: 'STRIPE', clientSecret: 'cs' });
    expect(stripe.createPaymentIntent).toHaveBeenCalledTimes(1);
  });

  it('con Stripe sin habilitar tampoco cobra: el dinero no debe caer en la cuenta de la plataforma', async () => {
    const { service, stripe } = build(true, false);

    const result = await service.create('tenant-1', 'cust-1', dto);

    expect(result).toMatchObject({ provider: 'MANUAL' });
    expect(stripe.createPaymentIntent).not.toHaveBeenCalled();
  });

  it('MercadoPago elegido pero sin cuenta conectada deja el pedido manual, no FALLIDO', async () => {
    const { service, stripe, mercadopago, prisma } = build(true);
    prisma.tenant.findUniqueOrThrow.mockResolvedValue({
      paymentProvider: 'MERCADOPAGO',
      mpConnected: false,
    });

    const result = await service.create('tenant-1', 'cust-1', dto);

    expect(result).toMatchObject({
      provider: 'MANUAL',
      paymentStatus: 'PENDING',
    });
    expect(mercadopago.createPayment).not.toHaveBeenCalled();
    expect(stripe.createPaymentIntent).not.toHaveBeenCalled();
    expect(prisma.order.update).not.toHaveBeenCalled();
  });
});
