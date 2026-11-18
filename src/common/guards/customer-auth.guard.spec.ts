import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../prisma/prisma.service';
import { CustomerAuthGuard } from './customer-auth.guard';

function ctx(
  headers: Record<string, string>,
  cookies?: Record<string, string>,
) {
  const req = { headers, cookies } as Record<string, unknown>;
  return {
    req,
    context: {
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext,
  };
}

function makeGuard(
  payload: Record<string, unknown> | Error,
  slug = 'origen',
  account: { deletedAt: Date | null } | null = { deletedAt: null },
) {
  const jwt = {
    verifyAsync: jest
      .fn()
      .mockImplementation(() =>
        payload instanceof Error
          ? Promise.reject(payload)
          : Promise.resolve(payload),
      ),
  } as unknown as JwtService;
  const config = { get: () => 'secret' } as unknown as ConfigService;
  const prisma = {
    tenant: { findUnique: jest.fn().mockResolvedValue({ slug }) },
    customer: { findUnique: jest.fn().mockResolvedValue(account) },
  } as unknown as PrismaService;
  return new CustomerAuthGuard(jwt, config, prisma);
}

const valid = {
  sub: 'c1',
  email: 'a@b.co',
  tenantId: 't-origen',
  type: 'customer',
};

describe('CustomerAuthGuard', () => {
  it('acepta la sesión cuando el tenant de la petición es el del token', async () => {
    const { context, req } = ctx(
      { 'x-tenant-slug': 'origen' },
      { customer_token: 'jwt' },
    );
    await expect(makeGuard(valid).canActivate(context)).resolves.toBe(true);
    expect(req.customer).toEqual({
      id: 'c1',
      email: 'a@b.co',
      tenantId: 't-origen',
    });
  });

  it('rechaza (403) una sesión de otra tienda', async () => {
    const { context } = ctx(
      { 'x-tenant-slug': 'cafe-prueba' },
      { customer_token: 'jwt' },
    );
    await expect(makeGuard(valid).canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('sin cabecera de tenant se comporta como antes (token válido)', async () => {
    const { context } = ctx({}, { customer_token: 'jwt' });
    await expect(makeGuard(valid).canActivate(context)).resolves.toBe(true);
  });

  it('rechaza sin token y con token inválido o de otro tipo', async () => {
    await expect(
      makeGuard(valid).canActivate(ctx({}).context),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      makeGuard(new Error('expired')).canActivate(
        ctx({}, { customer_token: 'x' }).context,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      makeGuard({ ...valid, type: 'admin' }).canActivate(
        ctx({}, { customer_token: 'x' }).context,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rechaza (401) la sesión de una cuenta eliminada aunque el token no haya vencido', async () => {
    const { context } = ctx({}, { customer_token: 'jwt' });
    await expect(
      makeGuard(valid, 'origen', { deletedAt: new Date() }).canActivate(
        context,
      ),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rechaza (401) la sesión de un cliente que ya no existe', async () => {
    const { context } = ctx({}, { customer_token: 'jwt' });
    await expect(
      makeGuard(valid, 'origen', null).canActivate(context),
    ).rejects.toThrow(UnauthorizedException);
  });
});
