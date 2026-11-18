import type { JwtService } from '@nestjs/jwt';
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../prisma/prisma.service';
import type { MailService } from '../mail/mail.service';
import type { MfaService } from './mfa.service';
import { AuthService } from './auth.service';

function setup(ownerEmail = 'root@plataforma.co') {
  const prisma = {
    tenantMembership: { findFirst: jest.fn() },
    user: { findUnique: jest.fn().mockResolvedValue({ totpEnabledAt: null }) },
  };
  const config = {
    get: jest.fn((k: string) =>
      k === 'platformOwnerEmail' ? ownerEmail : undefined,
    ),
  };
  const service = new AuthService(
    prisma as unknown as PrismaService,
    {} as JwtService,
    config as unknown as ConfigService,
    {} as MailService,
    {} as MfaService,
  );
  return { prisma, service };
}

describe('AuthService.getMe — rol en la tienda actual', () => {
  const user = { id: 'u1', email: 'dueno@demo.test' };

  it('sin X-Tenant-Slug no consulta membresías ni devuelve tenantRole', async () => {
    const { prisma, service } = setup();
    const me = await service.getMe(user);
    expect(me).toEqual({ ...user, isPlatformOwner: false, mfaRequired: null });
    expect(prisma.tenantMembership.findFirst).not.toHaveBeenCalled();
  });

  it('con slug devuelve el rol de ESE usuario en ESA tienda', async () => {
    const { prisma, service } = setup();
    prisma.tenantMembership.findFirst.mockResolvedValue({
      role: 'TENANT_EDITOR',
    });

    const me = await service.getMe(user, ' demo ');

    expect(prisma.tenantMembership.findFirst).toHaveBeenCalledWith({
      where: { userId: 'u1', tenant: { slug: 'demo' } },
      select: { role: true },
    });
    expect(me).toMatchObject({ tenantRole: 'TENANT_EDITOR' });
  });

  it('tenantRole es null si no es miembro de esa tienda', async () => {
    const { prisma, service } = setup();
    prisma.tenantMembership.findFirst.mockResolvedValue(null);
    const me = await service.getMe(user, 'otra');
    expect(me).toMatchObject({ tenantRole: null });
  });

  it('marca al dueño de la plataforma', async () => {
    const { service } = setup('dueno@demo.test');
    expect(await service.getMe({ ...user, mfa: true })).toMatchObject({
      isPlatformOwner: true,
      mfaRequired: null,
    });
  });

  it('dueño sin 2FA activado: mfaRequired = setup', async () => {
    const { service } = setup('dueno@demo.test');
    expect(await service.getMe(user)).toMatchObject({ mfaRequired: 'setup' });
  });

  it('dueño con 2FA pero sesión abierta sin código: mfaRequired = login', async () => {
    const { prisma, service } = setup('dueno@demo.test');
    prisma.user.findUnique.mockResolvedValue({ totpEnabledAt: new Date() });
    expect(await service.getMe(user)).toMatchObject({ mfaRequired: 'login' });
  });

  it('un operador de tienda nunca tiene mfaRequired', async () => {
    const { prisma, service } = setup();
    expect(await service.getMe(user)).toMatchObject({ mfaRequired: null });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});
