import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SiteContentKind } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  isContentPageSlug,
  storedPageContent,
  storedPageFlags,
} from './editorial-pages';

@Injectable()
export class ContentService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Contenido vigente del storefront para Home A. Filtra por `active` y por
   * ventana de vigencia (startsAt/endsAt). Agrupa por tipo: del hero/spotlight/
   * bundle se devuelve el primero por `position`; de anuncios, la lista (rotan).
   */
  async getHomeContent(tenantId: string) {
    const now = new Date();
    const vigente: Prisma.SiteContentWhereInput = {
      tenantId,
      active: true,
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
      ],
    };

    const items = await this.prisma.siteContent.findMany({
      where: vigente,
      orderBy: { position: 'asc' },
      select: { id: true, kind: true, data: true, position: true },
    });

    const byKind = (kind: SiteContentKind) =>
      items.filter((i) => i.kind === kind);

    return {
      announcements: byKind(SiteContentKind.ANNOUNCEMENT),
      hero: byKind(SiteContentKind.HERO)[0] ?? null,
      spotlight: byKind(SiteContentKind.SPOTLIGHT)[0] ?? null,
      featuredBundle: byKind(SiteContentKind.FEATURED_BUNDLE)[0] ?? null,
    };
  }

  /**
   * Página editorial pública de la tienda. Solo si está activada en
   * `branding.pages` y tiene contenido; si no, 404 (la ruta no existe).
   */
  async getPage(tenantId: string, slug: string) {
    if (!isContentPageSlug(slug)) {
      throw new NotFoundException('Página no encontrada');
    }
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { branding: true },
    });
    const content = tenant ? storedPageContent(tenant.branding, slug) : null;
    if (
      !tenant ||
      storedPageFlags(tenant.branding)[slug] !== true ||
      !content
    ) {
      throw new NotFoundException('Página no encontrada');
    }
    return { slug, ...content };
  }
}
