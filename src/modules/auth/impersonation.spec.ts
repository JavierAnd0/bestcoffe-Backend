import { JwtService } from '@nestjs/jwt';
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../prisma/prisma.service';
import type { MailService } from '../mail/mail.service';
import type { MfaService } from './mfa.service';
import { AuthService } from './auth.service';

const SECRET = 'test-secret-impersonation';

function setup(
  membership: unknown = { tenant: { slug: 'cafe-roma', name: 'Café Roma' } },
) {
  const jwt = new JwtService({ secret: SECRET });
  const prisma = {
    tenantMembership: { findFirst: jest.fn().mockResolvedValue(membership) },
  };
  const config = {
    get: jest.fn((k: string) => (k === 'jwt.secret' ? SECRET : undefined)),
  };
  const service = new AuthService(
    prisma as unknown as PrismaService,
    jwt,
    config as unknown as ConfigService,
    {} as MailService,
    {} as MfaService,
  );
  const pass = (extra: Record<string, unknown> = {}) =>
    jwt.signAsync(
      {
        sub: 'u1',
        email: 'dueno@roma.co',
        type: 'impersonation',
        tenantId: 't1',
        jti: 'j1',
        ...extra,
      },
      { expiresIn: '60s' },
    );
  return { jwt, prisma, service, pass };
}

describe('AuthService.exchangeImpersonation', () => {
  it('canjea el pase por una sesión de operador con 2FA en esa tienda', async () => {
    const { jwt, prisma, service, pass } = setup();
    const res = await service.exchangeImpersonation(await pass());

    expect(prisma.tenantMembership.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 't1', userId: 'u1', role: 'TENANT_OWNER' },
      }),
    );
    expect(res.tenant).toEqual({ slug: 'cafe-roma', name: 'Café Roma' });
    const session = await jwt.verifyAsync<Record<string, unknown>>(
      res.accessToken,
    );
    expect(session).toMatchObject({ sub: 'u1', type: 'operator', mfa: true });
  });

  it('un pase solo sirve una vez', async () => {
    const { service, pass } = setup();
    const token = await pass();
    await service.exchangeImpersonation(token);
    await expect(service.exchangeImpersonation(token)).rejects.toThrow(
      'ya se usó',
    );
  });

  it('rechaza una sesión normal usada como pase', async () => {
    const { service, pass } = setup();
    await expect(
      service.exchangeImpersonation(await pass({ type: 'operator' })),
    ).rejects.toThrow('inválido');
  });

  it('rechaza el pase si ya no es dueño de la tienda', async () => {
    const { service, pass } = setup(null);
    await expect(service.exchangeImpersonation(await pass())).rejects.toThrow(
      'inválido',
    );
  });
});
