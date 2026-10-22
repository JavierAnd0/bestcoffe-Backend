import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { OperatorRole } from '@prisma/client';

export interface CurrentUserData {
  id: string;
  email: string;
  role?: OperatorRole;
}

interface RequestWithUser extends Request {
  user?: CurrentUserData;
}

/** Inyecta el operador autenticado (payload del JWT validado por AuthGuard). */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentUserData | undefined => {
    const req = ctx.switchToHttp().getRequest<RequestWithUser>();
    return req.user;
  },
);
