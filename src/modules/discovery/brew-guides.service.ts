import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class BrewGuidesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string, cursor?: string, limit = 12) {
    const take = Math.min(limit, 50) + 1;
    const items = await this.prisma.brewGuide.findMany({
      where: { tenantId },
      take,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        slug: true,
        title: true,
        method: true,
        coverUrl: true,
        createdAt: true,
      },
    });
    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;
    return { items: page, nextCursor: hasMore ? page[page.length - 1].id : null };
  }

  async findBySlug(tenantId: string, slug: string) {
    const guide = await this.prisma.brewGuide.findUnique({
      where: { tenantId_slug: { tenantId, slug } },
    });
    if (!guide) throw new NotFoundException(`Brew guide "${slug}" no encontrado`);
    return guide;
  }
}
