import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantFeaturesService } from '../../common/features/tenant-features.service';
import { TIER_FEATURES } from '../../common/features/tier-features';
import { TenantDomainsService } from './tenant-domains.service';

/** Expone el punto de DNS para simularlo. */
class TestableDomains extends TenantDomainsService {
  txt: string[] = [];
  protected lookupTxt(): Promise<string[]> {
    return Promise.resolve(this.txt);
  }
}

describe('TenantDomainsService — dominios propios', () => {
  let prisma: {
    tenant: { findUnique: jest.Mock };
    tenantDomain: {
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
  };
  let service: TestableDomains;
  let customDomain: boolean;

  beforeEach(() => {
    customDomain = true;
    prisma = {
      tenant: { findUnique: jest.fn().mockResolvedValue({ id: 't1' }) },
      tenantDomain: {
        findFirst: jest.fn(),
        findUnique: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn((args: { data: object }) =>
          Promise.resolve({ id: 'd1', ...args.data }),
        ),
        update: jest.fn(),
      },
    };
    service = new TestableDomains(
      prisma as unknown as PrismaService,
      { get: () => 'secreto-de-prueba' } as unknown as ConfigService,
      {
        resolve: jest.fn(() =>
          Promise.resolve({
            flags: { ...TIER_FEATURES.BUSINESS, customDomain },
            tier: 'PRO',
          }),
        ),
      } as unknown as TenantFeaturesService,
    );
  });

  it('solo resuelve dominios verificados', async () => {
    prisma.tenantDomain.findFirst.mockResolvedValue(null);
    await expect(
      service.resolveSlug('tienda.caferoma.com'),
    ).resolves.toBeNull();
    expect(prisma.tenantDomain.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { domain: 'tienda.caferoma.com', verified: true },
      }),
    );
  });

  it('normaliza mayúsculas y puerto, y devuelve el slug', async () => {
    prisma.tenantDomain.findFirst.mockResolvedValue({
      tenant: { slug: 'cafe-roma' },
    });
    await expect(service.resolveSlug('Tienda.CafeRoma.com:443')).resolves.toBe(
      'cafe-roma',
    );
  });

  it('rechaza hosts con caracteres extraños sin consultar la base', async () => {
    await expect(service.resolveSlug('evil.com/../x')).resolves.toBeNull();
    expect(prisma.tenantDomain.findFirst).not.toHaveBeenCalled();
  });

  it('un dominio nuevo queda SIN verificar y devuelve el TXT a publicar', async () => {
    const created = await service.add('t1', 'Tienda.CafeRoma.com');
    expect(created).toMatchObject({
      domain: 'tienda.caferoma.com',
      verified: false,
      isPrimary: true,
    });
    expect(created.verification.host).toBe('_bestcoffee.tienda.caferoma.com');
    expect(created.verification.value).toMatch(
      /^bestcoffee-verify=[0-9a-f]{32}$/,
    );
  });

  it('exige el plan con dominio propio', async () => {
    customDomain = false;
    await expect(
      service.add('t1', 'tienda.caferoma.com'),
    ).rejects.toMatchObject({ status: 402 });
    expect(prisma.tenantDomain.create).not.toHaveBeenCalled();
  });

  it('no permite registrar un dominio que ya es de otra tienda', async () => {
    prisma.tenantDomain.findUnique.mockResolvedValue({ tenantId: 'otra' });
    await expect(
      service.add('t1', 'tienda.caferoma.com'),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('el valor de verificación es distinto por tienda', () => {
    expect(service.verificationValue('t1', 'a.com')).not.toBe(
      service.verificationValue('t2', 'a.com'),
    );
  });

  it('verifica cuando el TXT publicado coincide', async () => {
    prisma.tenantDomain.findFirst.mockResolvedValue({
      id: 'd1',
      domain: 'tienda.caferoma.com',
      verified: false,
    });
    service.txt = [
      'v=spf1 -all',
      service.verificationValue('t1', 'tienda.caferoma.com'),
    ];

    const res = await service.verify('t1', 'd1');

    expect(res.verified).toBe(true);
    expect(prisma.tenantDomain.update).toHaveBeenCalledWith({
      where: { id: 'd1' },
      data: { verified: true },
    });
  });

  it('no verifica con el TXT de otra tienda ni sin TXT', async () => {
    prisma.tenantDomain.findFirst.mockResolvedValue({
      id: 'd1',
      domain: 'tienda.caferoma.com',
      verified: false,
    });
    service.txt = [service.verificationValue('t2', 'tienda.caferoma.com')];
    expect((await service.verify('t1', 'd1')).verified).toBe(false);

    service.txt = [];
    expect((await service.verify('t1', 'd1')).verified).toBe(false);
    expect(prisma.tenantDomain.update).not.toHaveBeenCalled();
  });

  it('retira la verificación si el TXT desaparece', async () => {
    prisma.tenantDomain.findFirst.mockResolvedValue({
      id: 'd1',
      domain: 'tienda.caferoma.com',
      verified: true,
    });
    service.txt = [];

    expect((await service.verify('t1', 'd1')).verified).toBe(false);
    expect(prisma.tenantDomain.update).toHaveBeenCalledWith({
      where: { id: 'd1' },
      data: { verified: false },
    });
  });
});
