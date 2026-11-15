import { ClsService } from 'nestjs-cls';
import { PrismaService } from '../../prisma/prisma.service';
import { isSuspended, TenantFeaturesService } from './tenant-features.service';
import { TIER_FEATURES } from './tier-features';

describe('TenantFeaturesService — suspensión por cobro', () => {
  const serviceFor = (billingStatus: string) => {
    const prisma = {
      tenant: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ tier: 'BUSINESS', features: {}, billingStatus }),
      },
    };
    return {
      service: new TenantFeaturesService(
        prisma as unknown as PrismaService,
        { get: () => undefined } as unknown as ClsService,
      ),
      prisma,
    };
  };

  it.each(['CANCELLED', 'INACTIVE'])(
    'una tienda %s queda suspendida y sin ninguna capacidad',
    async (status) => {
      const { service } = serviceFor(status);
      const { flags, suspended } = await service.resolve('t1');

      expect(suspended).toBe(true);
      for (const [key, value] of Object.entries(flags)) {
        if (typeof value === 'boolean') {
          expect([key, value]).toEqual([key, false]);
        }
      }
    },
  );

  it.each(['ACTIVE', 'PAST_DUE'])(
    'una tienda %s conserva las capacidades de su plan',
    async (status) => {
      const { service } = serviceFor(status);
      const { flags, suspended } = await service.resolve('t1');

      expect(suspended).toBe(false);
      expect(flags).toEqual(TIER_FEATURES.BUSINESS);
    },
  );

  it('pago vencido avisa pero no suspende', () => {
    expect(isSuspended('PAST_DUE')).toBe(false);
    expect(isSuspended('ACTIVE')).toBe(false);
  });

  it('usa la caché y la invalida al cambiar el plan', async () => {
    const { service, prisma } = serviceFor('ACTIVE');
    await service.get('t1');
    await service.get('t1');
    expect(prisma.tenant.findUnique).toHaveBeenCalledTimes(1);

    service.invalidate('t1');
    await service.get('t1');
    expect(prisma.tenant.findUnique).toHaveBeenCalledTimes(2);
  });

  describe('tienda sandbox (demo)', () => {
    const sandboxService = (header: string | undefined, sandbox = true) => {
      const prisma = {
        tenant: {
          findUnique: jest.fn().mockResolvedValue({
            tier: 'BUSINESS',
            features: sandbox ? { demoSandbox: true } : {},
            billingStatus: 'ACTIVE',
          }),
        },
      };
      return new TenantFeaturesService(
        prisma as unknown as PrismaService,
        { get: () => header } as unknown as ClsService,
      );
    };

    it('aplica el estado elegido por el visitante', async () => {
      const service = sandboxService(
        JSON.stringify({ catalog: false, blog: false, checkout: false }),
      );
      const { flags } = await service.resolve('t1');
      expect(flags.catalog).toBe(false);
      expect(flags.blog).toBe(false);
      expect(flags.checkout).toBe(false);
      expect(flags.subscriptions).toBe(true);
    });

    it('nunca activa pagos en línea, ni aunque el visitante lo pida', async () => {
      const service = sandboxService(JSON.stringify({ onlinePayments: true }));
      expect((await service.resolve('t1')).flags.onlinePayments).toBe(false);
    });

    it('sin cabecera igual no cobra en línea: la demo nunca cobra', async () => {
      const { flags } = await sandboxService(undefined).resolve('t1');
      expect(flags.onlinePayments).toBe(false);
      expect(flags.checkout).toBe(true);
    });

    it('ignora claves desconocidas, tipos incorrectos y JSON roto', async () => {
      const a = await sandboxService(
        JSON.stringify({ inventada: true, catalog: 'no', maxProducts: 999 }),
      ).resolve('t1');
      expect(a.flags.catalog).toBe(true);
      expect(a.flags.maxProducts).toBe(TIER_FEATURES.BUSINESS.maxProducts);

      const b = await sandboxService('{no es json').resolve('t1');
      expect(b.flags.catalog).toBe(true);
    });

    it('una tienda que NO es sandbox ignora la cabecera por completo', async () => {
      const service = sandboxService(JSON.stringify({ catalog: false }), false);
      const { flags, sandbox } = await service.resolve('t1');
      expect(sandbox).toBe(false);
      expect(flags.catalog).toBe(true);
    });
  });
});
