import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { resolveTxt } from 'node:dns/promises';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantFeaturesService } from '../../common/features/tenant-features.service';

/** Subdominio donde la tienda publica su registro TXT de verificación. */
export const VERIFY_HOST_PREFIX = '_bestcoffee';
const VERIFY_VALUE_PREFIX = 'bestcoffee-verify=';

/**
 * Dominios propios de las tiendas (plan con `customDomain`).
 *
 * Un dominio solo enruta a una tienda cuando está VERIFICADO: su dueño debe
 * publicar un registro TXT con un valor que solo la plataforma puede calcular.
 * Sin esa prueba, cualquiera podría registrar el dominio de otro y recibir su
 * tráfico, o abrirse CORS con credenciales desde un dominio ajeno.
 */
@Injectable()
export class TenantDomainsService {
  // host → slug | null. TTL corto: el proxy del front consulta en cada visita.
  private readonly cache = new Map<
    string,
    { slug: string | null; exp: number }
  >();
  private static readonly TTL_MS = 60_000;
  private static readonly MAX_CACHE = 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly features: TenantFeaturesService,
  ) {}

  static normalize(host: string): string {
    return host.trim().toLowerCase().replace(/\.$/, '').split(':')[0];
  }

  /** Slug de la tienda dueña de un dominio verificado, o null. */
  async resolveSlug(rawHost: string): Promise<string | null> {
    const host = TenantDomainsService.normalize(rawHost);
    if (!host || !/^[a-z0-9.-]+$/.test(host)) return null;

    const now = Date.now();
    const cached = this.cache.get(host);
    if (cached && cached.exp > now) return cached.slug;

    const row = await this.prisma.tenantDomain.findFirst({
      where: { domain: host, verified: true },
      select: { tenant: { select: { slug: true } } },
    });
    const slug = row?.tenant.slug ?? null;
    // Acotada: el endpoint es público y cada host distinto añade una entrada.
    if (this.cache.size >= TenantDomainsService.MAX_CACHE) this.cache.clear();
    this.cache.set(host, { slug, exp: now + TenantDomainsService.TTL_MS });
    return slug;
  }

  /** Valor que debe llevar el TXT de verificación de este dominio. */
  verificationValue(tenantId: string, domain: string): string {
    const secret = this.config.get<string>('jwt.secret') ?? '';
    const digest = createHmac('sha256', secret)
      .update(`domain-verify:${tenantId}:${domain}`)
      .digest('hex')
      .slice(0, 32);
    return `${VERIFY_VALUE_PREFIX}${digest}`;
  }

  /** Instrucciones DNS para el dueño del dominio. */
  instructions(tenantId: string, domain: string) {
    return {
      type: 'TXT' as const,
      host: `${VERIFY_HOST_PREFIX}.${domain}`,
      value: this.verificationValue(tenantId, domain),
    };
  }

  async list(tenantId: string) {
    const rows = await this.prisma.tenantDomain.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((d) => ({
      ...d,
      verification: this.instructions(tenantId, d.domain),
    }));
  }

  async add(tenantId: string, rawDomain: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });
    if (!tenant) throw new NotFoundException('Tenant no encontrado');

    const { flags, tier } = await this.features.resolve(tenantId);
    if (!flags.customDomain) {
      throw new HttpException(
        {
          statusCode: HttpStatus.PAYMENT_REQUIRED,
          error: 'Feature no disponible en tu plan',
          message: `El dominio propio requiere un plan superior. El plan actual (${tier}) no lo incluye.`,
          feature: 'customDomain',
          currentTier: tier,
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }

    const domain = TenantDomainsService.normalize(rawDomain);
    if (!/^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(domain)) {
      throw new BadRequestException('Dominio inválido');
    }
    const taken = await this.prisma.tenantDomain.findUnique({
      where: { domain },
      select: { tenantId: true },
    });
    if (taken) {
      throw new ConflictException(
        taken.tenantId === tenantId
          ? 'Ese dominio ya está registrado en esta tienda'
          : 'Ese dominio ya está registrado en otra tienda',
      );
    }

    const hasPrimary = await this.prisma.tenantDomain.count({
      where: { tenantId, isPrimary: true },
    });
    const created = await this.prisma.tenantDomain.create({
      data: { tenantId, domain, isPrimary: hasPrimary === 0, verified: false },
    });
    return { ...created, verification: this.instructions(tenantId, domain) };
  }

  /** Comprueba el TXT en DNS y, si coincide, marca el dominio como verificado. */
  async verify(tenantId: string, domainId: string) {
    const row = await this.prisma.tenantDomain.findFirst({
      where: { id: domainId, tenantId },
    });
    if (!row) throw new NotFoundException('Dominio no encontrado');

    const expected = this.verificationValue(tenantId, row.domain);
    const found = await this.lookupTxt(`${VERIFY_HOST_PREFIX}.${row.domain}`);
    const ok = found.includes(expected);

    if (ok !== row.verified) {
      await this.prisma.tenantDomain.update({
        where: { id: row.id },
        data: { verified: ok },
      });
      this.cache.delete(row.domain);
    }
    return {
      id: row.id,
      domain: row.domain,
      verified: ok,
      verification: this.instructions(tenantId, row.domain),
      ...(ok
        ? {}
        : {
            reason:
              found.length === 0
                ? 'No se encontró el registro TXT. Los cambios de DNS pueden tardar en propagarse.'
                : 'El registro TXT existe pero su valor no coincide.',
          }),
    };
  }

  async remove(tenantId: string, domainId: string) {
    const row = await this.prisma.tenantDomain.findFirst({
      where: { id: domainId, tenantId },
      select: { id: true, domain: true },
    });
    if (!row) throw new NotFoundException('Dominio no encontrado');
    await this.prisma.tenantDomain.delete({ where: { id: row.id } });
    this.cache.delete(row.domain);
    return { removed: true as const };
  }

  /** Registros TXT de un host (vacío si no existe). Aislado para poder simularlo en pruebas. */
  protected async lookupTxt(host: string): Promise<string[]> {
    try {
      const records = await resolveTxt(host);
      return records.map((chunks) => chunks.join('').trim());
    } catch {
      return [];
    }
  }
}
