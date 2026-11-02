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
 * En desarrollo local sin `REVALIDATE_SECRET` configurado permite el paso
 * registrando una advertencia para no bloquear el entorno local.
 */
@Injectable()
export class InternalSecretGuard implements CanActivate {
  private readonly logger = new Logger(InternalSecretGuard.name);

  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const secret = this.config.get<string>('revalidate.secret') ?? '';
    const isProd = this.config.get<string>('nodeEnv') === 'production';

    if (!secret) {
      if (isProd) {
        throw new UnauthorizedException(
          'Secreto interno no configurado en el servidor',
        );
      }
      this.logger.warn(
        'REVALIDATE_SECRET vacío en dev — permitiendo petición a endpoint interno sin validar cabecera',
      );
      return true;
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
