import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { PrismaService } from '../../prisma/prisma.service';
import { CTX } from '../context/request-context';

/**
 * Resuelve el tenant desde el header `X-Tenant-Slug` (lo pega el SDK del front),
 * lo valida contra DB y lo inyecta en el request + store CLS para que cualquier
 * servicio lo lea. Toda query de negocio DEBE filtrar por este tenantId.
 *
 * Rutas globales de plataforma (app.bestcoffee.io) se marcan con @TenantOptional.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  // cache simple slug→id en memoria (TTL corto). Reemplazable por Redis.
  private readonly cache = new Map<string, { id: string; exp: number }>();
  private static readonly TTL_MS = 30_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const slug = (req.headers['x-tenant-slug'] as string)?.trim();

    if (!slug) {
      throw new BadRequestException('Falta el header X-Tenant-Slug');
    }

    const tenantId = await this.resolveTenantId(slug);
    if (!tenantId) {
      throw new NotFoundException(`Tenant "${slug}" no existe`);
    }

    req.tenantId = tenantId;
    req.tenantSlug = slug;
    this.cls.set(CTX.TENANT_ID, tenantId);
    this.cls.set(CTX.TENANT_SLUG, slug);

    return true;
  }

  private async resolveTenantId(slug: string): Promise<string | null> {
    const now = Date.now();
    const cached = this.cache.get(slug);
    if (cached && cached.exp > now) return cached.id;

    const tenant = await this.prisma.tenant.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!tenant) return null;

    this.cache.set(slug, { id: tenant.id, exp: now + TenantGuard.TTL_MS });
    return tenant.id;
  }
}
