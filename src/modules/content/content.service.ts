import { Injectable } from '@nestjs/common';
import { Prisma, SiteContentKind } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

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
}
