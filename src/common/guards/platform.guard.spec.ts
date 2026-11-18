import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../prisma/prisma.service';
import { PlatformGuard } from './platform.guard';

const OWNER = 'owner@bestcoffee.test';

function ctx() {
  const req = { headers: { authorization: 'Bearer jwt' } } as Record<
    string,
    unknown
  >;
  return {
    req,
    context: {
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext,
  };
}

function makeGuard(payload: Record<string, unknown>, userEmail = OWNER) {
  const jwt = {
    verifyAsync: jest.fn().mockResolvedValue(payload),
  } as unknown as JwtService;
  const config = {
    get: (key: string) => (key === 'platformOwnerEmail' ? OWNER : 'secret'),
  } as unknown as ConfigService;
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue({ id: 'u1', email: userEmail }),
    },
  } as unknown as PrismaService;
  return new PlatformGuard(jwt, config, prisma);
}

describe('PlatformGuard', () => {
  it('acepta la sesión de operador del dueño de la plataforma', async () => {
    const { context, req } = ctx();
    const guard = makeGuard({
      sub: 'u1',
      email: OWNER,
      type: 'operator',
      mfa: true,
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(req.user).toEqual({ id: 'u1', email: OWNER });
  });

  it('rechaza la sesión del dueño abierta sin 2FA (MFA_REQUIRED)', async () => {
    const { context } = ctx();
    const guard = makeGuard({ sub: 'u1', email: OWNER, type: 'operator' });
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      response: { code: 'MFA_REQUIRED' },
    });
  });

  it('rechaza el token pendiente de 2FA del dueño', async () => {
    const { context } = ctx();
    const guard = makeGuard({ sub: 'u1', email: OWNER, type: 'mfa_pending' });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rechaza un token sin tipo', async () => {
    const { context } = ctx();
    const guard = makeGuard({ sub: 'u1', email: OWNER });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rechaza a un operador que no es el dueño', async () => {
    const { context } = ctx();
    const guard = makeGuard(
      { sub: 'u2', email: 'otro@tienda.test', type: 'operator' },
      'otro@tienda.test',
    );
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
