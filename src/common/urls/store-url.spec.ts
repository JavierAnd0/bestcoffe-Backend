import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../prisma/prisma.service';
import { checkoutReturnBase } from '../checkout/return-url';
import { storeUrl } from './store-url';

const config = {
  get: (k: string) =>
    k === 'webAppUrl' ? 'https://bestkofi.com' : 'production',
} as unknown as ConfigService;

const prisma = {
  tenant: { findUnique: jest.fn().mockResolvedValue({ slug: 'origen' }) },
  tenantDomain: { findFirst: jest.fn().mockResolvedValue(null) },
} as unknown as PrismaService;

describe('URL de la tienda con dominio de plataforma', () => {
  const prev = process.env.PLATFORM_DOMAIN;
  beforeEach(() => (process.env.PLATFORM_DOMAIN = 'bestkofi.com'));
  afterAll(() => (process.env.PLATFORM_DOMAIN = prev));

  it('storeUrl arma <slug>.<dominio>, no la landing', () => {
    expect(storeUrl('origen', config)).toBe('https://origen.bestkofi.com');
  });

  it('sin dominio de plataforma usa WEB_APP_URL', () => {
    delete process.env.PLATFORM_DOMAIN;
    expect(storeUrl('origen', config)).toBe('https://bestkofi.com');
  });

  it('el checkout vuelve al subdominio de la tienda por defecto', async () => {
    await expect(
      checkoutReturnBase(prisma, config, 't1', 'ord1'),
    ).resolves.toBe(
      'https://origen.bestkofi.com/checkout/confirmacion?orderId=ord1',
    );
  });

  it('un origen ajeno pedido por el cliente se ignora', async () => {
    await expect(
      checkoutReturnBase(prisma, config, 't1', 'ord1', 'https://evil.test'),
    ).resolves.toBe(
      'https://origen.bestkofi.com/checkout/confirmacion?orderId=ord1',
    );
  });
});
