import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export interface CurrentTenantData {
  id: string;
  slug: string;
}

interface RequestWithTenant extends Request {
  tenantId?: string;
  tenantSlug?: string;
}

/** Inyecta `{ id, slug }` del tenant resuelto por TenantGuard. */
export const CurrentTenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentTenantData => {
    const req = ctx.switchToHttp().getRequest<RequestWithTenant>();
    return { id: req.tenantId ?? '', slug: req.tenantSlug ?? '' };
  },
);
