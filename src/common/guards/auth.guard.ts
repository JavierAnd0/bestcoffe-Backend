import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ClsService } from 'nestjs-cls';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { CTX } from '../context/request-context';

export interface JwtPayload {
  sub: string; // userId
  email: string;
  type?: 'operator';
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

    const req = context.switchToHttp().getRequest();
    const token = this.extractToken(req);
    if (!token) throw new UnauthorizedException('Falta token de autenticación');

    try {
      const payload = await this.jwt.verifyAsync<{
        sub: string;
        email: string;
        type?: string;
      }>(token, { secret: this.config.get<string>('jwt.secret') });
      // Defensa en profundidad: aunque los tokens de cliente se firman con un
      // secreto distinto (la firma ya no validaría aquí), rechazamos cualquier
      // token que no sea de operador en rutas de operador.
      if (payload.type === 'customer') {
        throw new UnauthorizedException('Tipo de token incorrecto');
      }
      req.user = { id: payload.sub, email: payload.email };
      this.cls.set(CTX.USER_ID, payload.sub);
      return true;
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException('Token inválido o expirado');
    }
  }

  private extractToken(req: { headers: Record<string, string> }): string | null {
    const header = req.headers['authorization'];
    if (!header) return null;
    const [type, token] = header.split(' ');
    return type === 'Bearer' && token ? token : null;
  }
}
