import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { REQUIRE_FEATURE_KEY } from '../decorators/require-feature.decorator';
import type { BooleanFeatureKey } from '../features/tier-features';
import { TenantFeaturesService } from '../features/tenant-features.service';
import type { CurrentCustomerData } from './customer-auth.guard';

interface RequestWithTenantAndCustomer extends Request {
  tenantId?: string;
  customer?: CurrentCustomerData;
}

/**
 * Bloquea el endpoint si el tier del tenant no incluye la capacidad exigida por
 * @RequireFeature. Resuelve el tenantId desde req.tenantId (TenantGuard) o desde
 * req.customer.tenantId (CustomerAuthGuard), así funciona en rutas de operador y
 * de cliente. Responde 402 para que el front distinga "falta plan" de "prohibido".
 *
 * Debe correr DESPUÉS del guard que resuelve el tenant.
 */
@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly features: TenantFeaturesService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const feature = this.reflector.getAllAndOverride<BooleanFeatureKey>(
      REQUIRE_FEATURE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!feature) return true;

    const req = context
      .switchToHttp()
      .getRequest<RequestWithTenantAndCustomer>();
    const tenantId: string | undefined = req.tenantId ?? req.customer?.tenantId;
    if (!tenantId) {
      throw new HttpException(
        'No se pudo resolver el tenant para validar el plan',
        HttpStatus.BAD_REQUEST,
      );
    }

    const { flags, tier } = await this.features.resolve(tenantId);

    if (!flags[feature]) {
      throw new HttpException(
        {
          statusCode: HttpStatus.PAYMENT_REQUIRED,
          error: 'Feature no disponible en tu plan',
          message: `Esta función requiere un plan superior. Tu plan actual (${tier}) no la incluye.`,
          feature,
          currentTier: tier,
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
    return true;
  }
}
