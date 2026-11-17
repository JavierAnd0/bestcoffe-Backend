import { ForbiddenException } from '@nestjs/common';
import type { OperatorRole } from '@prisma/client';
import { RolesGuard } from './roles.guard';

const build = (role: OperatorRole | null, required: OperatorRole[]) => {
  const reflector = { getAllAndOverride: jest.fn().mockReturnValue(required) };
  const prisma = {
    tenantMembership: {
      findUnique: jest.fn().mockResolvedValue(role ? { role } : null),
    },
  };
  const cls = { set: jest.fn() };
  const guard = new RolesGuard(
    reflector as never,
    prisma as never,
    cls as never,
  );
  const req = { user: { id: 'u1', email: 'a@b.co' }, tenantId: 't1' };
  const ctx = {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => req }),
  };
  return () => guard.canActivate(ctx as never);
};

describe('RolesGuard', () => {
  it.each<[OperatorRole, OperatorRole[]]>([
    ['TENANT_EDITOR', ['TENANT_EDITOR']],
    ['TENANT_ORDERS', ['TENANT_ORDERS']],
    ['TENANT_OWNER', ['TENANT_EDITOR']],
    ['TENANT_OWNER', ['TENANT_ORDERS']],
    ['TENANT_OWNER', ['TENANT_OWNER']],
    ['PLATFORM_OWNER', ['TENANT_OWNER']],
    ['TENANT_ORDERS', ['TENANT_OWNER', 'TENANT_EDITOR', 'TENANT_ORDERS']],
  ])('%s entra donde se exige %j', async (role, required) => {
    await expect(build(role, required)()).resolves.toBe(true);
  });

  it.each<[OperatorRole, OperatorRole[]]>([
    // Roles hermanos: ninguno entra en las rutas del otro.
    ['TENANT_ORDERS', ['TENANT_EDITOR']],
    ['TENANT_EDITOR', ['TENANT_ORDERS']],
    ['TENANT_EDITOR', ['TENANT_OWNER']],
    ['TENANT_ORDERS', ['TENANT_OWNER']],
  ])('%s NO entra donde se exige %j', async (role, required) => {
    await expect(build(role, required)()).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('sin membresía en la tienda: 403', async () => {
    await expect(build(null, ['TENANT_EDITOR'])()).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('sin @Roles: pasa', async () => {
    await expect(build('TENANT_EDITOR', [])()).resolves.toBe(true);
  });
});
