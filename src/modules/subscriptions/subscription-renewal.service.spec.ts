import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SubStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { StripeService } from '../stripe/stripe.service';
import { CartService } from '../cart/cart.service';
import { TenantFeaturesService } from '../../common/features/tenant-features.service';
import { TIER_FEATURES } from '../../common/features/tier-features';
import { SubscriptionRenewalService } from './subscription-renewal.service';

describe('SubscriptionRenewalService — tiendas suspendidas', () => {
  const build = (subscriptions: boolean) => {
    const prisma = {
      subscription: {
        groupBy: jest
          .fn()
          .mockResolvedValue([{ tenantId: 't1', _min: { nextShipAt: null } }]),
        findMany: jest.fn().mockResolvedValue([{ id: 's1', tenantId: 't1' }]),
        update: jest.fn(),
      },
    };
    const features = {
      get: jest.fn().mockResolvedValue({ ...TIER_FEATURES.PRO, subscriptions }),
    };
    const service = new SubscriptionRenewalService(
      prisma as unknown as PrismaService,
      {} as StripeService,
      features as unknown as TenantFeaturesService,
      {} as CartService,
      {} as ConfigService,
    );
    const renew = jest
      .spyOn(
        service as unknown as { renewSubscription: () => Promise<string> },
        'renewSubscription',
      )
      .mockResolvedValue('MANUAL');
    return { service, prisma, renew };
  };

  it('la consulta excluye tiendas canceladas o inactivas', async () => {
    const { service, prisma } = build(true);
    await service.processDueSubscriptions();
    expect(prisma.subscription.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenant: { billingStatus: { notIn: ['CANCELLED', 'INACTIVE'] } },
        }) as unknown,
      }),
    );
  });

  it('sin la capacidad subscriptions no cobra ni marca fallo de pago', async () => {
    const { service, prisma, renew } = build(false);
    const result = await service.processDueSubscriptions();
    expect(renew).not.toHaveBeenCalled();
    expect(prisma.subscription.update).not.toHaveBeenCalled();
    expect(result).toEqual({ processed: 0, skipped: 0, errors: 0 });
  });

  it('con la capacidad activa sí renueva', async () => {
    const { service, renew } = build(true);
    const result = await service.processDueSubscriptions();
    expect(renew).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ processed: 1, skipped: 0, errors: 0 });
  });
});

/**
 * Renovación con "pedidos sin pagos": crea un pedido PENDIENTE como cualquier
 * pedido manual, avanza la fecha y nunca marca PAYMENT_FAILED por no haber
 * pasarela.
 */
describe('SubscriptionRenewalService — renovación sin pasarela', () => {
  const due = {
    id: 'sub-1',
    tenantId: 't1',
    customerId: 'c1',
    status: SubStatus.SKIPPED_NEXT,
    frequencyDays: 14,
    discountPct: 10,
    nextShipAt: new Date('2026-01-01T00:00:00Z'),
    shippingAddress: { line1: 'Calle 1', city: 'Bogotá' },
    customer: { id: 'c1', stripeCustomerId: null },
    tenant: { paymentProvider: 'STRIPE' },
    variant: {
      id: 'v1',
      product: { name: 'Café', subscriptionAvailability: 'YES' },
    },
  };
  const priced = (over: Record<string, unknown> = {}) => ({
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
        outOfStock: false,
      },
    ],
    subtotalCents: 40_000_00,
    discountCents: 0,
    shippingCents: 12_000_00,
    totalCents: 52_000_00,
    ...over,
  });

  const build = (opts: { stripeEnabled?: boolean; claimed?: number } = {}) => {
    const tx = {
      subscription: {
        updateMany: jest.fn().mockResolvedValue({ count: opts.claimed ?? 1 }),
      },
      order: { create: jest.fn().mockResolvedValue({ id: 'ord-r1' }) },
    };
    const prisma = {
      subscription: {
        groupBy: jest
          .fn()
          .mockResolvedValue([{ tenantId: 't1', _min: { nextShipAt: null } }]),
        findMany: jest.fn().mockResolvedValue([due]),
        update: jest.fn().mockResolvedValue({}),
      },
      order: {
        update: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn().mockResolvedValue({
          customer: { email: 'cliente@example.com', name: 'Ana' },
          tenant: { name: 'Tienda Uno' },
        }),
      },
      $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    const cart = { price: jest.fn().mockResolvedValue(priced()) };
    const mail = {
      sendSubscriptionRenewalPending: jest.fn().mockResolvedValue(undefined),
    };
    const stripe = { chargeOffSession: jest.fn() };
    const service = new SubscriptionRenewalService(
      prisma as unknown as PrismaService,
      stripe as unknown as StripeService,
      {
        get: jest.fn().mockResolvedValue({
          ...TIER_FEATURES.BUSINESS,
          onlinePayments: true,
        }),
      } as unknown as TenantFeaturesService,
      cart as unknown as CartService,
      {
        get: jest.fn().mockReturnValue(opts.stripeEnabled ?? false),
      } as unknown as ConfigService,
      mail as unknown as MailService,
    );
    return { service, prisma, tx, cart, stripe, mail };
  };

  it('crea un pedido PENDIENTE de renovación con precio de suscripción, descuento y envío, y avanza la fecha', async () => {
    const { service, prisma, tx, cart, stripe } = build();

    const result = await service.processDueSubscriptions();

    expect(result).toEqual({ processed: 1, skipped: 0, errors: 0 });
    expect(cart.price).toHaveBeenCalledWith(
      't1',
      { items: [{ variantId: 'v1', quantity: 1 }], mode: 'SUBSCRIPTION' },
      'c1',
    );
    const updateArg = (
      tx.subscription.updateMany.mock.calls[0] as unknown[]
    )[0] as {
      where: Record<string, unknown>;
      data: { status: string; nextShipAt: Date };
    };
    expect(updateArg.where).toEqual({
      id: 'sub-1',
      status: SubStatus.SKIPPED_NEXT,
      nextShipAt: due.nextShipAt,
    });
    // Un salto consumido vuelve a ACTIVE.
    expect(updateArg.data.status).toBe(SubStatus.ACTIVE);
    expect(updateArg.data.nextShipAt.getTime()).toBeGreaterThan(Date.now());

    const orderArg = (tx.order.create.mock.calls[0] as unknown[])[0] as {
      data: Record<string, unknown>;
    };
    expect(orderArg.data).toMatchObject({
      source: 'SUBSCRIPTION_RENEWAL',
      status: 'RECEIVED',
      paymentStatus: 'PENDING',
      subscriptionId: 'sub-1',
      subtotalCents: 40_000_00,
      discountCents: 4_000_00,
      shippingCents: 12_000_00,
      totalCents: 48_000_00,
    });
    expect(stripe.chargeOffSession).not.toHaveBeenCalled();
    expect(prisma.subscription.update).not.toHaveBeenCalled();
  });

  it('avisa al cliente por correo del pedido de renovación pendiente', async () => {
    const { service, mail } = build();

    await service.processDueSubscriptions();
    await new Promise((r) => setImmediate(r));

    expect(mail.sendSubscriptionRenewalPending).toHaveBeenCalledWith({
      to: 'cliente@example.com',
      customerName: 'Ana',
      orderId: 'ord-r1',
      storeName: 'Tienda Uno',
      productName: expect.any(String) as unknown,
      totalCents: 48_000_00,
    });
  });

  it('con cobro de Stripe no envía el aviso de pedido pendiente', async () => {
    const { service, mail, stripe, prisma } = build({ stripeEnabled: true });
    prisma.subscription.findMany.mockResolvedValue([
      { ...due, customer: { id: 'c1', stripeCustomerId: 'cus_1' } },
    ]);
    stripe.chargeOffSession.mockResolvedValue({ piId: 'pi_1' });

    await service.processDueSubscriptions();
    await new Promise((r) => setImmediate(r));

    expect(mail.sendSubscriptionRenewalPending).not.toHaveBeenCalled();
  });

  it('sin stock no crea el pedido, no avanza la fecha y no marca fallo', async () => {
    const { service, prisma, tx, cart } = build();
    cart.price.mockResolvedValue(priced({ hasStockIssues: true }));

    const result = await service.processDueSubscriptions();

    expect(result).toEqual({ processed: 0, skipped: 1, errors: 0 });
    expect(tx.order.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.subscription.update).not.toHaveBeenCalled();
  });

  it('variante ya no disponible: se omite sin marcar fallo', async () => {
    const { service, prisma, cart } = build();
    cart.price.mockRejectedValue(new BadRequestException('no disponible'));

    const result = await service.processDueSubscriptions();

    expect(result).toEqual({ processed: 0, skipped: 1, errors: 0 });
    expect(prisma.subscription.update).not.toHaveBeenCalled();
  });

  it('si otra ejecución ya la renovó, no duplica el pedido', async () => {
    const { service, tx } = build({ claimed: 0 });

    const result = await service.processDueSubscriptions();

    expect(result).toEqual({ processed: 0, skipped: 1, errors: 0 });
    expect(tx.order.create).not.toHaveBeenCalled();
  });

  it('un error que no es de cobro no marca PAYMENT_FAILED', async () => {
    const { service, prisma } = build();
    (prisma.$transaction as jest.Mock).mockRejectedValue(new Error('db caída'));

    const result = await service.processDueSubscriptions();

    expect(result).toEqual({ processed: 0, skipped: 0, errors: 1 });
    expect(prisma.subscription.update).not.toHaveBeenCalled();
  });

  it('con Stripe habilitado y método guardado cobra fuera de sesión; si lo rechaza marca PAYMENT_FAILED', async () => {
    const { service, prisma, stripe } = build({ stripeEnabled: true });
    prisma.subscription.findMany.mockResolvedValue([
      { ...due, customer: { id: 'c1', stripeCustomerId: 'cus_1' } },
    ]);
    stripe.chargeOffSession.mockRejectedValue(new Error('card_declined'));

    const result = await service.processDueSubscriptions();

    expect(stripe.chargeOffSession).toHaveBeenCalledWith(
      'cus_1',
      48_000_00,
      'ord-r1',
      't1',
    );
    expect(result).toEqual({ processed: 0, skipped: 0, errors: 1 });
    expect(prisma.subscription.update).toHaveBeenCalledWith({
      where: { id: 'sub-1' },
      data: { status: SubStatus.PAYMENT_FAILED },
    });
  });

  it('con Stripe habilitado pero sin método guardado el pedido es manual', async () => {
    const { service, stripe } = build({ stripeEnabled: true });

    const result = await service.processDueSubscriptions();

    expect(result).toEqual({ processed: 1, skipped: 0, errors: 0 });
    expect(stripe.chargeOffSession).not.toHaveBeenCalled();
  });
});
