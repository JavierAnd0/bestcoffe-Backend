import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

/**
 * Protege endpoints internos servidor-a-servidor (ej. `/v1/auth/customer/neon-sync`)
 * exigiendo el secreto compartido `REVALIDATE_SECRET` en la cabecera
 * `x-internal-secret` o `x-revalidate-secret`.
 *
 * El secreto se exige SIEMPRE, en cualquier entorno accesible públicamente
 * (dev, staging, producción). La única excepción es NODE_ENV==='test', que
 * corresponde a la suite de tests local/CI y nunca queda expuesta en red.
 */
@Injectable()
export class InternalSecretGuard implements CanActivate {
  private readonly logger = new Logger(InternalSecretGuard.name);

  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const secret = this.config.get<string>('revalidate.secret') ?? '';
    const isLocalTest = this.config.get<string>('nodeEnv') === 'test';

    if (!secret) {
      if (isLocalTest) {
        this.logger.warn(
          'REVALIDATE_SECRET vacío en NODE_ENV=test — permitiendo petición a endpoint interno sin validar cabecera',
        );
        return true;
      }
      this.logger.error(
        'REVALIDATE_SECRET no configurado — rechazando petición a endpoint interno (requerido en todo entorno distinto de test)',
      );
      throw new UnauthorizedException(
        'Secreto interno no configurado en el servidor',
      );
    }

    const req = context.switchToHttp().getRequest<Request>();
    const providedHeader =
      req.headers['x-internal-secret'] ?? req.headers['x-revalidate-secret'];
    const provided = Array.isArray(providedHeader)
      ? providedHeader[0]
      : providedHeader;

    if (!provided || typeof provided !== 'string') {
      throw new UnauthorizedException('Secreto interno inválido o ausente');
    }

    const expectedBuf = Buffer.from(secret);
    const providedBuf = Buffer.from(provided);

    if (
      expectedBuf.length !== providedBuf.length ||
      !timingSafeEqual(expectedBuf, providedBuf)
    ) {
      throw new UnauthorizedException('Secreto interno inválido o ausente');
    }

    return true;
  }
}
