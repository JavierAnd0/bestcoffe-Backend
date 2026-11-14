import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';

export interface CustomerJwtPayload {
  sub: string; // Customer.id
  email: string;
  tenantId: string;
  type: 'customer';
}

export interface CurrentCustomerData {
  id: string;
  email: string;
  tenantId: string;
}

interface RequestWithCustomer extends Request {
  customer?: CurrentCustomerData;
}

export const CUSTOMER_COOKIE = 'customer_token';

@Injectable()
export class CustomerAuthGuard implements CanActivate {
  // tenantId → slug (TTL corto): el slug de un tenant casi nunca cambia.
  private readonly slugCache = new Map<string, { slug: string; exp: number }>();
  private static readonly SLUG_TTL_MS = 30_000;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * La sesión de un cliente pertenece a UNA tienda. Si la petición declara otra
   * (X-Tenant-Slug), se rechaza: así un token de la tienda A jamás opera en B.
   */
  private async assertSameTenant(
    req: Request,
    tokenTenantId: string,
  ): Promise<void> {
    const requested = (
      req.headers['x-tenant-slug'] as string | undefined
    )?.trim();
    if (!requested) return;

    const now = Date.now();
    let cached = this.slugCache.get(tokenTenantId);
    if (!cached || cached.exp <= now) {
      const t = await this.prisma.tenant.findUnique({
        where: { id: tokenTenantId },
        select: { slug: true },
      });
      if (!t) throw new ForbiddenException('Sesión de otra tienda');
      cached = { slug: t.slug, exp: now + CustomerAuthGuard.SLUG_TTL_MS };
      this.slugCache.set(tokenTenantId, cached);
    }
    if (cached.slug !== requested) {
      throw new ForbiddenException('Esta sesión pertenece a otra tienda');
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithCustomer>();
    const token = this.extractToken(req);
    if (!token) throw new UnauthorizedException('Falta token de autenticación');

    try {
      const payload = await this.jwt.verifyAsync<CustomerJwtPayload>(token, {
        secret: this.config.get<string>('jwt.customerSecret'),
      });
      if (payload.type !== 'customer') {
        throw new Error('tipo de token incorrecto');
      }
      await this.assertSameTenant(req, payload.tenantId);
      req.customer = {
        id: payload.sub,
        email: payload.email,
        tenantId: payload.tenantId,
      } satisfies CurrentCustomerData;
      return true;
    } catch (e) {
      if (e instanceof ForbiddenException) throw e;
      throw new UnauthorizedException('Token inválido o expirado');
    }
  }

  // Cookie HttpOnly primaria; Authorization Bearer como fallback para clientes nativos.
  private extractToken(req: {
    cookies?: Record<string, string>;
    headers: Record<string, string | string[] | undefined>;
  }): string | null {
    if (req.cookies?.[CUSTOMER_COOKIE]) return req.cookies[CUSTOMER_COOKIE];
    const header = req.headers['authorization'];
    if (!header || typeof header !== 'string') return null;
    const [type, token] = header.split(' ');
    return type === 'Bearer' && token ? token : null;
  }
}
