import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { REQUIRE_FEATURE_KEY } from '../decorators/require-feature.decorator';
import {
  resolveFeatures,
  type BooleanFeatureKey,
} from '../features/tier-features';

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
  // cache corto tenantId→{tier,features} para no pegar a DB en cada request.
  private readonly cache = new Map<
    string,
    { tier: string; features: unknown; exp: number }
  >();
  private static readonly TTL_MS = 30_000;

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const feature = this.reflector.getAllAndOverride<BooleanFeatureKey>(
      REQUIRE_FEATURE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!feature) return true;

    const req = context.switchToHttp().getRequest();
    const tenantId: string | undefined =
      req.tenantId ?? req.customer?.tenantId;
    if (!tenantId) {
      throw new HttpException(
        'No se pudo resolver el tenant para validar el plan',
        HttpStatus.BAD_REQUEST,
      );
    }

    const { tier, features } = await this.resolveTenant(tenantId);
    const flags = resolveFeatures(tier, features);

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

  private async resolveTenant(tenantId: string) {
    const now = Date.now();
    const cached = this.cache.get(tenantId);
    if (cached && cached.exp > now) {
      return { tier: cached.tier as never, features: cached.features };
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { tier: true, features: true },
    });
    if (!tenant) {
      throw new HttpException('Tenant no encontrado', HttpStatus.NOT_FOUND);
    }

    this.cache.set(tenantId, {
      tier: tenant.tier,
      features: tenant.features,
      exp: now + FeatureGuard.TTL_MS,
    });
    return tenant;
  }
}
