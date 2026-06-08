import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface CurrentTenantData {
  id: string;
  slug: string;
}

/** Inyecta `{ id, slug }` del tenant resuelto por TenantGuard. */
export const CurrentTenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentTenantData => {
    const req = ctx.switchToHttp().getRequest();
    return { id: req.tenantId, slug: req.tenantSlug };
  },
);
