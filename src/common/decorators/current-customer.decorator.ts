import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { CurrentCustomerData } from '../guards/customer-auth.guard';

/** Inyecta el cliente autenticado (payload validado por CustomerAuthGuard). */
export const CurrentCustomer = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentCustomerData => {
    const req = ctx.switchToHttp().getRequest();
    return req.customer;
  },
);
