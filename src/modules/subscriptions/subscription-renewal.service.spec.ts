import { PrismaService } from '../../prisma/prisma.service';
import { StripeService } from '../stripe/stripe.service';
import { TenantFeaturesService } from '../../common/features/tenant-features.service';
import { TIER_FEATURES } from '../../common/features/tier-features';
import { SubscriptionRenewalService } from './subscription-renewal.service';

describe('SubscriptionRenewalService — tiendas suspendidas', () => {
  const build = (subscriptions: boolean) => {
    const prisma = {
      subscription: {
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
    );
    const renew = jest
      .spyOn(
        service as unknown as { renewSubscription: () => Promise<void> },
        'renewSubscription',
      )
      .mockResolvedValue(undefined);
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
    expect(result).toEqual({ processed: 0, errors: 0 });
  });

  it('con la capacidad activa sí renueva', async () => {
    const { service, renew } = build(true);
    const result = await service.processDueSubscriptions();
    expect(renew).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ processed: 1, errors: 0 });
  });
});
