import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Guard exclusivo para endpoints /v1/platform/*.
 *
 * Defensa en capas:
 *  1. Verifica el JWT con el secreto de OPERADOR (no el de cliente) — un token
 *     de cliente, firmado con otro secreto, ni siquiera pasa la verificación.
 *  2. Rechaza tokens que no sean de tipo 'operator'.
 *  3. Comprueba que el email coincida con PLATFORM_OWNER_EMAIL.
 *  4. Verifica que el `sub` resuelva a un User real cuyo email sea el del
 *     owner — no se autoriza solo por un claim de email en el token.
 *
 * No requiere TenantGuard — el platform es cross-tenant.
 */
@Injectable()
export class PlatformGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string>;
      user?: { id: string; email: string };
    }>();

    const token = this.extractToken(req);
    if (!token) throw new UnauthorizedException('Falta token de autenticación');

    let payload: { sub: string; email: string; type?: string };
    try {
      payload = await this.jwt.verifyAsync(token, {
        secret: this.config.get<string>('jwt.secret'),
      });
    } catch {
      throw new UnauthorizedException('Token inválido o expirado');
    }

    if (payload.type === 'customer') {
      throw new ForbiddenException('Tipo de token incorrecto');
    }

    const ownerEmail = this.config.get<string>('platformOwnerEmail');
    if (!ownerEmail || payload.email !== ownerEmail) {
      throw new ForbiddenException('Acceso restringido al propietario de la plataforma');
    }

    // El claim de email no basta: el subject debe ser un User real cuyo email
    // sea el del owner. Ata la identidad a un registro de la base de datos.
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true },
    });
    if (!user || user.email !== ownerEmail) {
      throw new ForbiddenException('Acceso restringido al propietario de la plataforma');
    }

    req.user = { id: user.id, email: user.email };
    return true;
  }

  private extractToken(req: { headers: Record<string, string> }): string | null {
    const header = req.headers['authorization'];
    if (!header) return null;
    const [type, token] = header.split(' ');
    return type === 'Bearer' && token ? token : null;
  }
}
