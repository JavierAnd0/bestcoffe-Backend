import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RevalidationService } from '../revalidation/revalidation.service';
import { firstFreeSlug, slugify } from '../content/slug.util';
import { CreateBlogPostDto, UpdateBlogPostDto } from './dto/save-blog-post.dto';

export type BlogPostStatus = 'DRAFT' | 'SCHEDULED' | 'PUBLISHED';

/** Estado legible para el panel a partir de `publishedAt`. */
export function blogPostStatus(
  publishedAt: Date | null,
  now = new Date(),
): BlogPostStatus {
  if (!publishedAt) return 'DRAFT';
  return publishedAt > now ? 'SCHEDULED' : 'PUBLISHED';
}

const LIST_SELECT = {
  id: true,
  slug: true,
  title: true,
  excerpt: true,
  coverUrl: true,
  publishedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * Administración del blog de la tienda. Toda consulta filtra por `tenantId`:
 * un operador nunca lee ni toca artículos de otra tienda (un id ajeno = 404).
 */
@Injectable()
export class AdminBlogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly revalidation: RevalidationService,
  ) {}

  /** Todos los artículos, borradores incluidos, más recientes primero. */
  async list(tenantId: string) {
    const posts = await this.prisma.blogPost.findMany({
      where: { tenantId },
      orderBy: [{ updatedAt: 'desc' }],
      select: LIST_SELECT,
    });
    const now = new Date();
    return posts.map((p) => ({
      ...p,
      status: blogPostStatus(p.publishedAt, now),
    }));
  }

  async findOne(tenantId: string, id: string) {
    const post = await this.prisma.blogPost.findFirst({
      where: { id, tenantId },
      select: { ...LIST_SELECT, body: true },
    });
    if (!post) throw new NotFoundException('Artículo no encontrado');
    return { ...post, status: blogPostStatus(post.publishedAt) };
  }

  async create(tenantId: string, tenantSlug: string, dto: CreateBlogPostDto) {
    const slug = dto.slug
      ? await this.assertSlugFree(tenantId, dto.slug)
      : await firstFreeSlug(slugify(dto.title, 'articulo'), (s) =>
          this.slugTaken(tenantId, s),
        );

    const post = await this.prisma.blogPost.create({
      data: {
        tenantId,
        slug,
        title: dto.title.trim(),
        excerpt: emptyToNull(dto.excerpt),
        body: dto.body,
        coverUrl: emptyToNull(dto.coverUrl),
        publishedAt: dto.published
          ? dto.publishedAt
            ? new Date(dto.publishedAt)
            : new Date()
          : null,
      },
      select: { ...LIST_SELECT, body: true },
    });
    this.revalidate(tenantSlug, [post.slug]);
    return { ...post, status: blogPostStatus(post.publishedAt) };
  }

  async update(
    tenantId: string,
    tenantSlug: string,
    id: string,
    dto: UpdateBlogPostDto,
  ) {
    const existing = await this.ensure(tenantId, id);
    if (dto.slug && dto.slug !== existing.slug) {
      await this.assertSlugFree(tenantId, dto.slug);
    }
    if (dto.publishedAt && dto.published === false) {
      throw new BadRequestException(
        'publishedAt solo aplica a un artículo publicado',
      );
    }

    const publishedAt = this.nextPublishedAt(existing.publishedAt, dto);

    const post = await this.prisma.blogPost.update({
      where: { id: existing.id },
      data: {
        ...(dto.title !== undefined && { title: dto.title.trim() }),
        ...(dto.slug !== undefined && { slug: dto.slug }),
        ...(dto.excerpt !== undefined && {
          excerpt: emptyToNull(dto.excerpt),
        }),
        ...(dto.body !== undefined && { body: dto.body }),
        ...(dto.coverUrl !== undefined && {
          coverUrl: emptyToNull(dto.coverUrl),
        }),
        ...(publishedAt !== undefined && { publishedAt }),
      },
      select: { ...LIST_SELECT, body: true },
    });
    this.revalidate(tenantSlug, [existing.slug, post.slug]);
    return { ...post, status: blogPostStatus(post.publishedAt) };
  }

  /** Publica ya (o conserva la fecha si ya estaba publicado/programado). */
  publish(tenantId: string, tenantSlug: string, id: string) {
    return this.update(tenantId, tenantSlug, id, { published: true });
  }

  /** Vuelve a borrador: deja de verse en la tienda. */
  unpublish(tenantId: string, tenantSlug: string, id: string) {
    return this.update(tenantId, tenantSlug, id, { published: false });
  }

  async remove(tenantId: string, tenantSlug: string, id: string) {
    const existing = await this.ensure(tenantId, id);
    await this.prisma.blogPost.delete({ where: { id: existing.id } });
    this.revalidate(tenantSlug, [existing.slug]);
    return { id: existing.id, deleted: true };
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  /**
   * `undefined` = no tocar. Publicar sin fecha conserva la existente (no
   * "republica" un artículo viejo); despublicar la borra.
   */
  private nextPublishedAt(
    current: Date | null,
    dto: UpdateBlogPostDto,
  ): Date | null | undefined {
    if (dto.published === false) return null;
    if (dto.publishedAt) {
      if (dto.published !== true && !current) {
        throw new BadRequestException(
          'Para fijar publishedAt en un borrador envía también published=true',
        );
      }
      return new Date(dto.publishedAt);
    }
    if (dto.published === true) return current ?? new Date();
    return undefined;
  }

  private async ensure(tenantId: string, id: string) {
    const post = await this.prisma.blogPost.findFirst({
      where: { id, tenantId },
      select: { id: true, slug: true, publishedAt: true },
    });
    if (!post) throw new NotFoundException('Artículo no encontrado');
    return post;
  }

  private async slugTaken(tenantId: string, slug: string) {
    const clash = await this.prisma.blogPost.findUnique({
      where: { tenantId_slug: { tenantId, slug } },
      select: { id: true },
    });
    return !!clash;
  }

  private async assertSlugFree(tenantId: string, slug: string) {
    if (await this.slugTaken(tenantId, slug)) {
      throw new BadRequestException(`El slug "${slug}" ya está en uso`);
    }
    return slug;
  }

  private revalidate(tenantSlug: string, slugs: string[]) {
    this.revalidation.dispatch(tenantSlug, [
      'blog',
      ...new Set(slugs.map((s) => `blog:${s}`)),
    ]);
  }
}

function emptyToNull(value: string | undefined): string | null {
  const v = value?.trim();
  return v ? v : null;
}
