import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { StripeService } from '../stripe/stripe.service';
import { CartService } from '../cart/cart.service';
import { TenantFeaturesService } from '../../common/features/tenant-features.service';
import { TIER_FEATURES } from '../../common/features/tier-features';
import { SubscriptionRenewalService } from './subscription-renewal.service';

/**
 * Las suscripciones que no se pueden renovar (sin stock, producto archivado…)
 * no avanzan su fecha. Antes, 50 de ellas al frente de un lote global
 * bloqueaban las renovaciones de todas las demás tiendas.
 */
type Row = { id: string; tenantId: string; nextShipAt: Date };
type Where = {
  tenantId?: string;
  OR?: Array<{ nextShipAt: Date | { gt: Date }; id?: { gt: string } }>;
};

const DAY = 24 * 60 * 60 * 1000;

function store(rows: Row[]) {
  const matches = (r: Row, where: Where) => {
    if (where.tenantId && r.tenantId !== where.tenantId) return false;
    if (!where.OR) return true;
    return where.OR.some((c) =>
      c.nextShipAt instanceof Date
        ? r.nextShipAt.getTime() === c.nextShipAt.getTime() &&
          r.id > (c.id?.gt ?? '')
        : r.nextShipAt.getTime() > c.nextShipAt.gt.getTime(),
    );
  };
  const sorted = () =>
    [...rows].sort(
      (a, b) =>
        a.nextShipAt.getTime() - b.nextShipAt.getTime() ||
        a.id.localeCompare(b.id),
    );
  return {
    groupBy: jest.fn(() => {
      const min = new Map<string, Date>();
      for (const r of rows) {
        const cur = min.get(r.tenantId);
        if (!cur || r.nextShipAt < cur) min.set(r.tenantId, r.nextShipAt);
      }
      return Promise.resolve(
        [...min].map(([tenantId, d]) => ({
          tenantId,
          _min: { nextShipAt: d },
        })),
      );
    }),
    findMany: jest.fn(({ where, take }: { where: Where; take: number }) =>
      Promise.resolve(
        sorted()
          .filter((r) => matches(r, where))
          .slice(0, take),
      ),
    ),
    update: jest.fn(),
  };
}

function build(rows: Row[], flagsFor: (tenantId: string) => boolean) {
  const subscription = store(rows);
  const features = {
    get: jest.fn((tenantId: string) =>
      Promise.resolve({
        ...TIER_FEATURES.PRO,
        subscriptions: flagsFor(tenantId),
      }),
    ),
  };
  const service = new SubscriptionRenewalService(
    { subscription } as unknown as PrismaService,
    {} as StripeService,
    features as unknown as TenantFeaturesService,
    {} as CartService,
    {} as ConfigService,
  );
  // La tienda A no se puede renovar (p. ej. sin stock): devuelve SKIPPED.
  const renew = jest
    .spyOn(
      service as unknown as {
        renewSubscription: (s: Row) => Promise<string>;
      },
      'renewSubscription',
    )
    .mockImplementation((s: Row) =>
      Promise.resolve(s.tenantId === 'tA' ? 'SKIPPED' : 'MANUAL'),
    );
  return { service, renew, subscription };
}

describe('SubscriptionRenewalService · reparto entre tiendas', () => {
  const now = Date.now();
  const stuck: Row[] = Array.from({ length: 60 }, (_, i) => ({
    id: `a-${String(i).padStart(3, '0')}`,
    tenantId: 'tA',
    nextShipAt: new Date(now - 10 * DAY),
  }));
  const other: Row = {
    id: 'b-001',
    tenantId: 'tB',
    nextShipAt: new Date(now - 1 * DAY),
  };

  it('60 suscripciones atascadas de una tienda no impiden renovar las de otra', async () => {
    const { service, renew } = build([...stuck, other], () => true);

    const result = await service.processDueSubscriptions();

    const renewedIds = renew.mock.calls.map(([s]) => s.id);
    expect(renewedIds).toContain('b-001');
    // Recorre las 60 de la tienda A una sola vez cada una (sin repetir).
    expect(new Set(renewedIds.filter((id) => id.startsWith('a-'))).size).toBe(
      60,
    );
    expect(result).toEqual({ processed: 1, skipped: 60, errors: 0 });
  });

  it('una tienda sin la capacidad de suscripciones se salta entera sin cargar sus filas', async () => {
    const { service, renew, subscription } = build(
      [...stuck, other],
      (t) => t !== 'tA',
    );

    await service.processDueSubscriptions();

    expect(renew.mock.calls.map(([s]) => s.id)).toEqual(['b-001']);
    const queriedTenants = subscription.findMany.mock.calls.map(
      ([arg]) => arg.where.tenantId,
    );
    expect(queriedTenants).not.toContain('tA');
  });
});
