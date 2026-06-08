import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ListBlogDto } from './dto/list-blog.dto';

@Injectable()
export class BlogService {
  constructor(private readonly prisma: PrismaService) {}

  /** Posts publicados (publishedAt <= now), paginación keyset por fecha. */
  async list(tenantId: string, query: ListBlogDto) {
    const limit = query.limit ?? 12;
    const where: Prisma.BlogPostWhereInput = {
      tenantId,
      publishedAt: { not: null, lte: new Date() },
    };

    const items = await this.prisma.blogPost.findMany({
      where,
      take: limit + 1,
      ...(query.cursor && { cursor: { id: query.cursor }, skip: 1 }),
      orderBy: { publishedAt: 'desc' },
      select: {
        id: true,
        slug: true,
        title: true,
        excerpt: true,
        coverUrl: true,
        publishedAt: true,
      },
    });

    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;
    return {
      items: page,
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  /** Detalle de post publicado por slug. */
  async findBySlug(tenantId: string, slug: string) {
    const post = await this.prisma.blogPost.findUnique({
      where: { tenantId_slug: { tenantId, slug } },
      select: {
        id: true,
        slug: true,
        title: true,
        excerpt: true,
        body: true,
        coverUrl: true,
        publishedAt: true,
      },
    });
    if (!post || !post.publishedAt || post.publishedAt > new Date()) {
      throw new NotFoundException(`Post "${slug}" no encontrado`);
    }
    return post;
  }
}
