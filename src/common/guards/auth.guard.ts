import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { ClsService } from 'nestjs-cls';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { CTX } from '../context/request-context';

export interface JwtPayload {
  sub: string; // userId
  email: string;
  /**
   * 'operator' = sesión de operador. 'mfa_pending' = pasó el enlace mágico pero
   * aún le falta el código de 2FA: solo sirve para `POST /v1/auth/mfa/verify`.
   * 'impersonation' = pase de un minuto que el superadmin lleva a la tienda:
   * solo sirve para `POST /v1/auth/impersonation`, que lo canjea por la sesión.
   */
  type?: 'operator' | 'mfa_pending' | 'impersonation';
  /** Solo en el pase de impersonación: tienda a la que da acceso y uso único. */
  tenantId?: string;
  jti?: string;
  /** La sesión se abrió con el código de 2FA (o justo al activarlo). */
  mfa?: boolean;
}

/** Respuesta 403 cuando la cuenta de la plataforma no pasó por el 2FA. */
export const MFA_REQUIRED = 'MFA_REQUIRED';

/**
 * La cuenta dueña de la plataforma solo opera con una sesión abierta con 2FA.
 * Sin ella, solo puede usar /v1/auth/* (ver su cuenta y activar el 2FA).
 */
export function platformOwnerNeedsMfa(
  email: string,
  mfa: boolean | undefined,
  ownerEmail: string | undefined,
): boolean {
  return !!ownerEmail && email === ownerEmail && mfa !== true;
}

interface RequestWithUser extends Request {
  user?: { id: string; email: string; mfa?: boolean };
}

/**
 * Valida el `Authorization: Bearer <jwt>` de operador. Las rutas marcadas
 * con @Public se saltan. El JWT se firma con JWT_SECRET, compartido con el
 * front (Auth.js) para sesiones de cliente final.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly reflector: Reflector,
    private readonly cls: ClsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<RequestWithUser>();
    const token = this.extractToken(req);
    if (!token) throw new UnauthorizedException('Falta token de autenticación');

    try {
      const payload = await this.jwt.verifyAsync<{
        sub: string;
        email: string;
        type?: string;
        mfa?: boolean;
      }>(token, { secret: this.config.get<string>('jwt.secret') });
      // Solo una sesión de operador abre rutas de operador. Con el mismo secreto
      // se firman otros tokens (el paso pendiente de 2FA, el `state` de OAuth de
      // MercadoPago) que no deben valer como sesión; todas las sesiones reales
      // llevan `type: 'operator'`.
      if (payload.type !== 'operator') {
        throw new UnauthorizedException('Tipo de token incorrecto');
      }
      const path = (req.originalUrl ?? req.url ?? '').split('?')[0];
      if (
        platformOwnerNeedsMfa(
          payload.email,
          payload.mfa,
          this.config.get<string>('platformOwnerEmail'),
        ) &&
        !path.startsWith('/v1/auth/')
      ) {
        throw new ForbiddenException({
          statusCode: 403,
          code: MFA_REQUIRED,
          message:
            'La cuenta de la plataforma necesita la verificación en dos pasos.',
        });
      }
      req.user = {
        id: payload.sub,
        email: payload.email,
        mfa: payload.mfa === true,
      };
      this.cls.set(CTX.USER_ID, payload.sub);
      return true;
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      if (err instanceof ForbiddenException) throw err;
      throw new UnauthorizedException('Token inválido o expirado');
    }
  }

  private extractToken(req: {
    headers: Record<string, string | string[] | undefined>;
  }): string | null {
    const header = req.headers['authorization'];
    if (!header || typeof header !== 'string') return null;
    const [type, token] = header.split(' ');
    return type === 'Bearer' && token ? token : null;
  }
}
