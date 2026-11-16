import { DiscountType, GrindFormat } from '@prisma/client';
import { CartService } from './cart.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantFeaturesService } from '../../common/features/tenant-features.service';
import { TIER_FEATURES } from '../../common/features/tier-features';

/**
 * Reglas de cupones al cotizar: ninguna compra queda en $0 y los usos de un
 * cupón cuentan también los pedidos pendientes (cobro manual o pago en curso).
 */
describe('CartService.price · cupones', () => {
  let service: CartService;
  let prisma: {
    productVariant: { findMany: jest.Mock };
    discountCode: { findUnique: jest.Mock };
    order: { findFirst: jest.Mock; count: jest.Mock };
    tenant: { findUnique: jest.Mock };
  };

  // $35.000 por unidad; envío de $12.000, gratis desde $100.000.
  const variant = {
    id: 'var-1',
    sizeGrams: 250,
    grind: GrindFormat.WHOLE_BEAN,
    priceOneTime: 3_500_000,
    priceSubscription: null,
    stock: 10,
    product: {
      slug: 'geisha',
      name: 'Geisha',
      subscriptionAvailability: 'BOTH',
    },
  };

  const coupon = (over: Record<string, unknown> = {}) => ({
    id: 'dc-1',
    tenantId: 't1',
    code: 'CAFE',
    type: DiscountType.PERCENTAGE,
    value: 10,
    minSubtotalCents: null,
    maxRedemptions: null,
    timesRedeemed: 0,
    oneUsePerCustomer: false,
    startsAt: null,
    endsAt: null,
    active: true,
    ...over,
  });

  beforeEach(() => {
    prisma = {
      productVariant: { findMany: jest.fn().mockResolvedValue([variant]) },
      discountCode: { findUnique: jest.fn() },
      order: {
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
      },
      tenant: {
        findUnique: jest.fn().mockResolvedValue({
          features: {
            freeShippingThresholdCents: 10_000_000,
            shippingFlatCents: 1_200_000,
          },
        }),
      },
    };
    service = new CartService(
      prisma as unknown as PrismaService,
      {
        get: jest.fn().mockResolvedValue(TIER_FEATURES.PRO),
      } as unknown as TenantFeaturesService,
    );
  });

  const price = (quantity: number, customerId?: string) =>
    service.price(
      't1',
      { items: [{ variantId: 'var-1', quantity }], discountCode: 'cafe' },
      customerId,
    );

  it('un cupón que deja la compra en $0 no se aplica', async () => {
    // 3 × $35.000 = $105.000 → envío gratis; un 100 % la dejaría en $0.
    prisma.discountCode.findUnique.mockResolvedValue(coupon({ value: 100 }));

    const r = await price(3);

    expect(r.discount?.valid).toBe(false);
    expect(r.discountCents).toBe(0);
    expect(r.totalCents).toBe(10_500_000);
  });

  it('un 100 % con envío a cargo sigue siendo válido: el total no es $0', async () => {
    prisma.discountCode.findUnique.mockResolvedValue(coupon({ value: 100 }));

    const r = await price(1);

    expect(r.discount?.valid).toBe(true);
    expect(r.totalCents).toBe(1_200_000);
  });

  it('un cupón de un solo uso cuenta los pedidos pendientes del cliente', async () => {
    prisma.discountCode.findUnique.mockResolvedValue(
      coupon({ oneUsePerCustomer: true }),
    );
    prisma.order.findFirst.mockResolvedValue({ id: 'order-previo' });

    const r = await price(1, 'cust-1');

    expect(r.discount?.valid).toBe(false);
    const where = (
      prisma.order.findFirst.mock.calls[0] as [
        { where: Record<string, unknown> },
      ]
    )[0].where;
    expect(where.paymentStatus).toEqual({ in: ['PAID', 'PENDING'] });
    expect(where.status).toEqual({ not: 'CANCELLED' });
  });

  it('el tope de usos suma los pedidos pendientes a los ya pagados', async () => {
    prisma.discountCode.findUnique.mockResolvedValue(
      coupon({ maxRedemptions: 2, timesRedeemed: 1 }),
    );
    prisma.order.count.mockResolvedValue(1);

    const r = await price(1);

    expect(r.discount?.valid).toBe(false);
    expect(r.discount?.reason).toBe('Código agotado');
  });

  it('con usos disponibles el cupón se aplica', async () => {
    prisma.discountCode.findUnique.mockResolvedValue(
      coupon({ maxRedemptions: 3, timesRedeemed: 1 }),
    );
    prisma.order.count.mockResolvedValue(1);

    const r = await price(1);

    expect(r.discount?.valid).toBe(true);
    expect(r.discountCents).toBe(350_000);
  });
});
