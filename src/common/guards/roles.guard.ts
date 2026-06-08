import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import type { OperatorRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { CTX } from '../context/request-context';

/**
 * Verifica que el operador autenticado tenga, en el tenant actual, uno de los
 * roles exigidos por @Roles. Resuelve el rol desde TenantMembership y lo deja
 * en req.user.role + CLS. Debe correr DESPUÉS de AuthGuard y TenantGuard.
 *
 * Jerarquía: PLATFORM_OWNER > TENANT_OWNER > TENANT_EDITOR / TENANT_ORDERS.
 */
const RANK: Record<OperatorRole, number> = {
  TENANT_ORDERS: 1,
  TENANT_EDITOR: 1,
  TENANT_OWNER: 2,
  PLATFORM_OWNER: 3,
};

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly cls: ClsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<OperatorRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest();
    const userId: string | undefined = req.user?.id;
    const tenantId: string | undefined = req.tenantId;
    if (!userId || !tenantId) {
      throw new ForbiddenException('Sesión o tenant no resueltos');
    }

    const membership = await this.prisma.tenantMembership.findUnique({
      where: { userId_tenantId: { userId, tenantId } },
      select: { role: true },
    });
    if (!membership) {
      throw new ForbiddenException('No tienes acceso a este tenant');
    }

    const role = membership.role;
    req.user.role = role;
    this.cls.set(CTX.ROLE, role);

    const allowed =
      role === 'PLATFORM_OWNER' ||
      required.some((r) => RANK[role] >= RANK[r]);
    if (!allowed) {
      throw new ForbiddenException('Rol insuficiente para esta acción');
    }
    return true;
  }
}
