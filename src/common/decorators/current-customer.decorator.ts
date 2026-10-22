import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { CurrentCustomerData } from '../guards/customer-auth.guard';

interface RequestWithCustomer extends Request {
  customer?: CurrentCustomerData;
}

/** Inyecta el cliente autenticado (payload validado por CustomerAuthGuard). */
export const CurrentCustomer = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentCustomerData | undefined => {
    const req = ctx.switchToHttp().getRequest<RequestWithCustomer>();
    return req.customer;
  },
);
