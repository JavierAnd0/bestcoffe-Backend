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

/** Ninguna compra puede pasar en $0, aunque el cálculo lo permitiera. */
describe('CheckoutService.create · total cero', () => {
  it('rechaza un pedido cuyo total es $0 sin crear la orden', async () => {
    const prisma = {
      tenant: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          paymentProvider: 'MERCADOPAGO',
          mpConnected: false,
        }),
      },
      $transaction: jest.fn(),
    };
    const cart = {
      price: jest.fn().mockResolvedValue({
        hasStockIssues: false,
        lines: [],
        subtotalCents: 0,
        discountCents: 0,
        shippingCents: 0,
        totalCents: 0,
      }),
    };
    const service = new CheckoutService(
      prisma as unknown as PrismaService,
      cart as unknown as CartService,
      {} as StripeService,
      {} as MercadoPagoService,
      {} as ConfigService,
      {} as TenantFeaturesService,
    );

    await expect(
      service.create('t1', 'cust-1', {
        items: [{ variantId: 'v1', quantity: 1 }],
        shippingAddress: { line1: 'Calle 1', city: 'Bogotá', country: 'CO' },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

/**
 * Pedido por suscripción: crea la suscripción en la misma transacción del
 * pedido, esperando el pago, y enlaza el pedido.
 */
describe('CheckoutService.create · suscripción', () => {
  const priced = {
    hasStockIssues: false,
    lines: [
      {
        variantId: 'v1',
        productName: 'Café',
        sizeGrams: 250,
        grind: 'WHOLE_BEAN',
        unitCents: 40_000_00,
        quantity: 1,
        lineCents: 40_000_00,
      },
    ],
    subtotalCents: 40_000_00,
    discountCents: 0,
    shippingCents: 0,
    totalCents: 40_000_00,
    discount: undefined,
  };

  const build = (
    opts: {
      subscriptions?: boolean;
      availability?: string;
      existing?: Array<Record<string, unknown>>;
    } = {},
  ) => {
    const tx = {
      cartItem: { deleteMany: jest.fn() },
      subscription: {
        findMany: jest.fn().mockResolvedValue(opts.existing ?? []),
        create: jest.fn().mockResolvedValue({ id: 'sub-new' }),
        update: jest.fn().mockResolvedValue({}),
      },
      order: {
        create: jest.fn().mockResolvedValue({ id: 'ord-1', totalCents: 1 }),
      },
    };
    const prisma = {
      tenant: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ paymentProvider: 'STRIPE', mpConnected: false }),
      },
      productVariant: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'v1',
            product: {
              name: 'Café',
              type: 'COFFEE',
              status: 'ACTIVE',
              subscriptionAvailability: opts.availability ?? 'YES',
            },
          },
        ]),
      },
      $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    const cart = { price: jest.fn().mockResolvedValue(priced) };
    const service = new CheckoutService(
      prisma as unknown as PrismaService,
      cart as unknown as CartService,
      {} as StripeService,
      {} as MercadoPagoService,
      { get: jest.fn().mockReturnValue(false) } as unknown as ConfigService,
      {
        get: jest.fn().mockResolvedValue({
          onlinePayments: false,
          subscriptions: opts.subscriptions ?? true,
        }),
      } as unknown as TenantFeaturesService,
    );
    return { service, tx, cart };
  };

  const dto = (over: Record<string, unknown> = {}) =>
    ({
      items: [{ variantId: 'v1', quantity: 1 }],
      mode: PurchaseMode.SUBSCRIPTION,
      frequencyDays: 21,
      shippingAddress: { line1: 'Calle 1', city: 'Bogotá', country: 'CO' },
      ...over,
    }) as never;

  it('crea la suscripción esperando el pago y enlaza el pedido', async () => {
    const { service, tx } = build();

    const result = await service.create('t1', 'c1', dto());

    const subArg = (tx.subscription.create.mock.calls[0] as unknown[])[0] as {
      data: Record<string, unknown>;
    };
    expect(subArg.data).toMatchObject({
      tenantId: 't1',
      customerId: 'c1',
      variantId: 'v1',
      frequencyDays: 21,
      status: 'PAYMENT_FAILED',
      lastShippedAt: null,
      shippingAddress: { line1: 'Calle 1', city: 'Bogotá', country: 'CO' },
    });
    expect(tx.order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ subscriptionId: 'sub-new' }) as unknown,
      }),
    );
    expect(result).toMatchObject({
      provider: 'MANUAL',
      summary: { subscriptionIds: ['sub-new'] },
    });
  });

  it('la frecuencia de la línea manda sobre la del pedido; sin ninguna, 30 días', async () => {
    const { service, tx } = build();
    await service.create(
      't1',
      'c1',
      dto({ items: [{ variantId: 'v1', quantity: 1, frequencyDays: 14 }] }),
    );
    await service.create('t1', 'c1', dto({ frequencyDays: undefined }));
    const freqs = tx.subscription.create.mock.calls.map(
      (c: [{ data: { frequencyDays: number } }]) => c[0].data.frequencyDays,
    );
    expect(freqs).toEqual([14, 30]);
  });

  it('reutiliza la suscripción que aún espera su primer pago (no duplica)', async () => {
    const { service, tx } = build({
      existing: [
        {
          id: 'sub-old',
          variantId: 'v1',
          status: 'PAYMENT_FAILED',
          lastShippedAt: null,
          variant: { product: { name: 'Café' } },
        },
      ],
    });

    await service.create('t1', 'c1', dto());

    expect(tx.subscription.create).not.toHaveBeenCalled();
    expect(tx.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'sub-old' } }),
    );
    expect(tx.order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ subscriptionId: 'sub-old' }) as unknown,
      }),
    );
  });

  it('rechaza (409) si ya tiene una suscripción viva a ese café', async () => {
    const { service, tx } = build({
      existing: [
        {
          id: 'sub-act',
          variantId: 'v1',
          status: 'ACTIVE',
          lastShippedAt: new Date(),
          variant: { product: { name: 'Café' } },
        },
      ],
    });

    await expect(service.create('t1', 'c1', dto())).rejects.toMatchObject({
      status: 409,
    });
    expect(tx.order.create).not.toHaveBeenCalled();
  });

  it('tienda sin la capacidad subscriptions responde 402 sin cotizar', async () => {
    const { service, cart } = build({ subscriptions: false });
    await expect(service.create('t1', 'c1', dto())).rejects.toMatchObject({
      status: 402,
    });
    expect(cart.price).not.toHaveBeenCalled();
  });

  it('rechaza productos no suscribibles y cantidades mayores a 1', async () => {
    const { service } = build({ availability: 'NO' });
    await expect(service.create('t1', 'c1', dto())).rejects.toBeInstanceOf(
      BadRequestException,
    );
    const ok = build();
    await expect(
      ok.service.create(
        't1',
        'c1',
        dto({ items: [{ variantId: 'v1', quantity: 2 }] }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('un invitado no puede crear un pedido por suscripción', async () => {
    const { service, cart } = build();
    await expect(
      service.create('t1', 'c1', dto(), { guest: true }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(cart.price).not.toHaveBeenCalled();
  });
});
