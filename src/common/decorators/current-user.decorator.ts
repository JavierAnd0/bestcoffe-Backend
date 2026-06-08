import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { OperatorRole } from '@prisma/client';

export interface CurrentUserData {
  id: string;
  email: string;
  role?: OperatorRole;
}

/** Inyecta el operador autenticado (payload del JWT validado por AuthGuard). */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentUserData | undefined => {
    const req = ctx.switchToHttp().getRequest();
    return req.user;
  },
);
