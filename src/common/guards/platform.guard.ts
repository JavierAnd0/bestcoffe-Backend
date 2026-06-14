import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { JwtPayload } from './auth.guard';

/**
 * Guard exclusivo para endpoints /v1/platform/*.
 * Valida el JWT y verifica que el email coincida con PLATFORM_OWNER_EMAIL.
 * No requiere TenantGuard — el platform es cross-tenant.
 */
@Injectable()
export class PlatformGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string>;
      user?: { id: string; email: string };
    }>();

    const token = this.extractToken(req);
    if (!token) throw new UnauthorizedException('Falta token de autenticación');

    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token, {
        secret: this.config.get<string>('jwt.secret'),
      });
    } catch {
      throw new UnauthorizedException('Token inválido o expirado');
    }

    const ownerEmail = this.config.get<string>('platformOwnerEmail');
    if (!ownerEmail || payload.email !== ownerEmail) {
      throw new ForbiddenException('Acceso restringido al propietario de la plataforma');
    }

    req.user = { id: payload.sub, email: payload.email };
    return true;
  }

  private extractToken(req: { headers: Record<string, string> }): string | null {
    const header = req.headers['authorization'];
    if (!header) return null;
    const [type, token] = header.split(' ');
    return type === 'Bearer' && token ? token : null;
  }
}
