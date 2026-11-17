import { ExecutionContext, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Tier } from '@prisma/client';
import { REQUIRE_FEATURE_KEY } from '../decorators/require-feature.decorator';
import { FeatureGuard } from '../guards/feature.guard';
import { TenantFeaturesService } from './tenant-features.service';
import {
  resolveFeatures,
  TIER_FEATURES,
  type BooleanFeatureKey,
  type FeatureFlags,
} from './tier-features';
import { BlogController } from '../../modules/blog/blog.controller';
import { ProductsController } from '../../modules/products/products.controller';
import { CollectionsController } from '../../modules/collections/collections.controller';
import { QuizController } from '../../modules/quiz/quiz.controller';
import { CartController } from '../../modules/cart/cart.controller';
import { CheckoutController } from '../../modules/orders/checkout.controller';
import { CustomerAuthController } from '../../modules/customers/customer-auth.controller';
import { CustomerSubscriptionsController } from '../../modules/subscriptions/customer-subscriptions.controller';
import { ReviewsController } from '../../modules/reviews/reviews.controller';
import { AdminReviewsController } from '../../modules/reviews/admin-reviews.controller';
import { AdminPromotionsController } from '../../modules/promotions/admin-promotions.controller';
import { GiftsCustomerController } from '../../modules/gifts/gifts-customer.controller';
import { GiftsAdminController } from '../../modules/gifts/gifts-admin.controller';

const BOOLEAN_FEATURES = (
  Object.keys(TIER_FEATURES.PRO) as (keyof FeatureFlags)[]
).filter(
  (k) => typeof TIER_FEATURES.PRO[k] === 'boolean',
) as BooleanFeatureKey[];

describe('Catálogo de features', () => {
  it('todos los tiers declaran exactamente las mismas claves', () => {
    const keys = Object.keys(TIER_FEATURES.STARTER).sort();
    for (const tier of Object.values(Tier)) {
      expect(Object.keys(TIER_FEATURES[tier]).sort()).toEqual(keys);
    }
  });

  it('STARTER es solo presencia: catálogo sin pedidos ni pagos', () => {
    const f = TIER_FEATURES.STARTER;
    expect(f.catalog).toBe(true);
    expect(f.checkout).toBe(false);
    expect(f.onlinePayments).toBe(false);
    expect(f.customerAccounts).toBe(false);
  });

  it('un override puede dar pedidos sin pagos en línea', () => {
    const f = resolveFeatures(Tier.PRO, { onlinePayments: false });
    expect(f.checkout).toBe(true);
    expect(f.onlinePayments).toBe(false);
  });

  it('un override puede dejar la tienda como solo landing', () => {
    const f = resolveFeatures(Tier.STARTER, { catalog: false, blog: false });
    expect(f.catalog).toBe(false);
    expect(f.blog).toBe(false);
  });

  it('ignora claves desconocidas y valores de tipo incorrecto', () => {
    const f = resolveFeatures(Tier.STARTER, {
      checkout: 'sí',
      inventada: true,
      maxProducts: '99',
    });
    expect(f).toEqual(TIER_FEATURES.STARTER);
  });
});

describe('FeatureGuard', () => {
  const contextFor = (feature: BooleanFeatureKey | undefined) => {
    const handler = () => undefined;
    if (feature) Reflect.defineMetadata(REQUIRE_FEATURE_KEY, feature, handler);
    return {
      getHandler: () => handler,
      getClass: () => class {},
      switchToHttp: () => ({ getRequest: () => ({ tenantId: 'tenant-1' }) }),
    } as unknown as ExecutionContext;
  };

  const guardWith = (flags: FeatureFlags) =>
    new FeatureGuard(new Reflector(), {
      resolve: jest.fn().mockResolvedValue({ flags, tier: 'PRO' }),
    } as unknown as TenantFeaturesService);

  it.each(BOOLEAN_FEATURES)(
    '%s apagada responde 402 y encendida deja pasar',
    async (feature) => {
      const off = { ...TIER_FEATURES.BUSINESS, [feature]: false };
      const on = { ...TIER_FEATURES.STARTER, [feature]: true };

      await expect(
        guardWith(off).canActivate(contextFor(feature)),
      ).rejects.toMatchObject({ status: 402 });
      await expect(
        guardWith(on).canActivate(contextFor(feature)),
      ).resolves.toBe(true);
    },
  );

  it('el 402 dice qué feature falta y el plan actual', async () => {
    const off = { ...TIER_FEATURES.PRO, checkout: false };
    const err = (await guardWith(off)
      .canActivate(contextFor('checkout'))
      .catch((e: unknown) => e)) as HttpException;
    expect(err.getResponse()).toMatchObject({
      feature: 'checkout',
      currentTier: 'PRO',
    });
  });

  it('una ruta sin @RequireFeature no consulta el plan', async () => {
    await expect(
      guardWith(TIER_FEATURES.STARTER).canActivate(contextFor(undefined)),
    ).resolves.toBe(true);
  });
});

/**
 * Qué feature exige cada controlador. Si alguien quita un @RequireFeature (o
 * añade un módulo vendible sin protegerlo), esta tabla falla.
 */
describe('Protección por feature en los controladores', () => {
  const featureOf = (target: object) =>
    Reflect.getMetadata(REQUIRE_FEATURE_KEY, target) as
      BooleanFeatureKey | undefined;

  it.each([
    [BlogController, 'blog'],
    [ProductsController, 'catalog'],
    [CollectionsController, 'catalog'],
    [QuizController, 'catalog'],
    [CartController, 'checkout'],
    [AdminPromotionsController, 'discountCodes'],
    [AdminReviewsController, 'reviews'],
    [GiftsAdminController, 'gifts'],
  ] as const)('%p exige la feature %s en toda la clase', (ctrl, feature) => {
    expect(featureOf(ctrl)).toBe(feature);
  });

  it.each([
    [CheckoutController, 'create', 'checkout'],
    [CheckoutController, 'createGuest', 'checkout'],
    [CustomerAuthController, 'register', 'customerAccounts'],
    [CustomerAuthController, 'login', 'customerAccounts'],
    [CustomerSubscriptionsController, 'create', 'subscriptions'],
    [ReviewsController, 'create', 'reviews'],
    [GiftsCustomerController, 'redeem', 'gifts'],
  ] as const)('%p.%s exige la feature %s', (ctrl, method, feature) => {
    const handler = (ctrl.prototype as unknown as Record<string, unknown>)[
      method
    ];
    expect(typeof handler).toBe('function');
    expect(featureOf(handler as object)).toBe(feature);
  });
});
