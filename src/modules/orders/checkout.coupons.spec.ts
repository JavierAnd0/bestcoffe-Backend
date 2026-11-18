import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { CartService } from '../cart/cart.service';
import { StripeService } from '../stripe/stripe.service';
import { MercadoPagoService } from '../mercadopago/mercadopago.service';
import { TenantFeaturesService } from '../../common/features/tenant-features.service';
import { PurchaseMode } from '../cart/dto/price-cart.dto';
import { CheckoutService } from './checkout.service';

/**
 * Cupones (auditoría #5 y #6):
 * - un invitado no puede usar un cupón de un solo uso (su "cliente" es un
 *   correo sin verificar: con uno nuevo por pedido lo reutilizaba sin límite);
 * - los límites del cupón se vuelven a validar dentro de la transacción con la
 *   fila del cupón bloqueada, para que dos checkouts a la vez no los superen.
 */
describe('CheckoutService · cupones', () => {
  const pricedWith = (valid: boolean) => ({
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
    discountCents: valid ? 1_000_00 : 0,
    shippingCents: 0,
    totalCents: valid ? 4_000_00 : 5_000_00,
    discount: valid
      ? { code: 'ONCE', valid: true, amountCents: 1_000_00 }
      : undefined,
  });

  type Coupon = {
    maxRedemptions: number | null;
    timesRedeemed: number;
    oneUsePerCustomer: boolean;
    active: boolean;
  };

  function build(opts: {
    coupon?: Coupon;
    pending?: number;
    previousUse?: boolean;
    validPrice?: boolean;
  }) {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue(opts.coupon ? [opts.coupon] : []),
      cartItem: { deleteMany: jest.fn() },
      order: {
        count: jest.fn().mockResolvedValue(opts.pending ?? 0),
        findFirst: jest
          .fn()
          .mockResolvedValue(opts.previousUse ? { id: 'o-prev' } : null),
        create: jest.fn().mockResolvedValue({
          id: 'ord-1',
          totalCents: 4_000_00,
          subscriptionIds: [],
        }),
      },
    };
    const prisma = {
      tenant: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ paymentProvider: 'STRIPE', mpConnected: false }),
      },
      customer: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({ id: 'guest-cus' }),
      },
      order: { update: jest.fn() },
      $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    const cart = {
      price: jest.fn().mockResolvedValue(pricedWith(opts.validPrice ?? true)),
    };
    const service = new CheckoutService(
      prisma as unknown as PrismaService,
      cart as unknown as CartService,
      {} as StripeService,
      {} as MercadoPagoService,
      { get: jest.fn().mockReturnValue(false) } as unknown as ConfigService,
      {
        get: jest.fn().mockResolvedValue({ onlinePayments: false }),
      } as unknown as TenantFeaturesService,
    );
    return { service, tx, cart };
  }

  const dto = {
    items: [{ variantId: 'v1', quantity: 1 }],
    mode: PurchaseMode.ONE_TIME,
    discountCode: 'ONCE',
    shippingAddress: { line1: 'Calle 1', city: 'Bogotá', country: 'CO' },
  } as never;

  it('un invitado se cotiza sin cliente (el cupón de un solo uso lo rechaza la validación)', async () => {
    const { service, cart } = build({ validPrice: false });

    await service.createGuest('tenant-1', {
      ...(dto as object),
      email: 'nuevo@correo.test',
    } as never);

    expect(cart.price).toHaveBeenCalledWith(
      'tenant-1',
      expect.anything(),
      undefined,
    );
  });

  it('un cliente con sesión sí se cotiza con su id', async () => {
    const { service, cart } = build({
      coupon: {
        maxRedemptions: null,
        timesRedeemed: 0,
        oneUsePerCustomer: true,
        active: true,
      },
    });

    await service.create('tenant-1', 'cust-1', dto);

    expect(cart.price).toHaveBeenCalledWith(
      'tenant-1',
      expect.anything(),
      'cust-1',
    );
  });

  it('bloquea la fila del cupón y crea el pedido si sigue disponible', async () => {
    const { service, tx } = build({
      coupon: {
        maxRedemptions: 5,
        timesRedeemed: 2,
        oneUsePerCustomer: true,
        active: true,
      },
      pending: 1,
    });

    await service.create('tenant-1', 'cust-1', dto);

    const calls = tx.$queryRaw.mock.calls as Array<[string[]]>;
    const sql = calls[0][0].join('?');
    expect(sql).toContain('FOR UPDATE');
    expect(tx.order.create).toHaveBeenCalled();
  });

  it('rechaza si el tope se alcanzó mientras se confirmaba (otro pedido simultáneo)', async () => {
    const { service, tx } = build({
      coupon: {
        maxRedemptions: 1,
        timesRedeemed: 0,
        oneUsePerCustomer: false,
        active: true,
      },
      pending: 1, // el pedido del otro checkout ya existe al tomar el bloqueo
    });

    await expect(service.create('tenant-1', 'cust-1', dto)).rejects.toThrow(
      BadRequestException,
    );
    expect(tx.order.create).not.toHaveBeenCalled();
  });

  it('rechaza un segundo uso del mismo cliente creado en paralelo', async () => {
    const { service, tx } = build({
      coupon: {
        maxRedemptions: null,
        timesRedeemed: 0,
        oneUsePerCustomer: true,
        active: true,
      },
      previousUse: true,
    });

    await expect(service.create('tenant-1', 'cust-1', dto)).rejects.toThrow(
      'Ya has utilizado este código de descuento',
    );
    expect(tx.order.create).not.toHaveBeenCalled();
  });

  it('rechaza un cupón desactivado entre la cotización y el pedido', async () => {
    const { service, tx } = build({
      coupon: {
        maxRedemptions: null,
        timesRedeemed: 0,
        oneUsePerCustomer: false,
        active: false,
      },
    });

    await expect(service.create('tenant-1', 'cust-1', dto)).rejects.toThrow(
      'El cupón ya no está disponible',
    );
    expect(tx.order.create).not.toHaveBeenCalled();
  });
});
