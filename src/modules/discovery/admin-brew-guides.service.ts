import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { BrewGuide } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RevalidationService } from '../revalidation/revalidation.service';
import { firstFreeSlug, slugify } from '../content/slug.util';
import {
  parseBrewGuideBody,
  serializeBrewGuideBody,
  type BrewGuideContent,
} from './brew-guide-body';
import {
  CreateBrewGuideDto,
  UpdateBrewGuideDto,
} from './dto/save-brew-guide.dto';

/** Guía con la estructura expandida (lo que consume el panel y la tienda). */
export function toBrewGuideView(g: BrewGuide) {
  const { id, slug, title, method, coverUrl, createdAt, updatedAt, body } = g;
  return {
    id,
    slug,
    title,
    method,
    coverUrl,
    createdAt,
    updatedAt,
    ...parseBrewGuideBody(body),
  };
}

/**
 * Administración de las guías de preparación de la tienda. Toda consulta
 * filtra por `tenantId`: un id de otra tienda responde 404.
 */
@Injectable()
export class AdminBrewGuidesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly revalidation: RevalidationService,
  ) {}

  async list(tenantId: string) {
    const guides = await this.prisma.brewGuide.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
    return guides.map(toBrewGuideView);
  }

  async findOne(tenantId: string, id: string) {
    return toBrewGuideView(await this.ensure(tenantId, id));
  }

  async create(tenantId: string, tenantSlug: string, dto: CreateBrewGuideDto) {
    const slug = dto.slug
      ? await this.assertSlugFree(tenantId, dto.slug)
      : await firstFreeSlug(slugify(dto.method || dto.title, 'guia'), (s) =>
          this.slugTaken(tenantId, s),
        );

    const guide = await this.prisma.brewGuide.create({
      data: {
        tenantId,
        slug,
        title: dto.title.trim(),
        method: emptyToNull(dto.method),
        coverUrl: emptyToNull(dto.coverUrl),
        body: serializeBrewGuideBody(this.content(dto)),
      },
    });
    this.revalidate(tenantSlug, [guide.slug]);
    return toBrewGuideView(guide);
  }

  async update(
    tenantId: string,
    tenantSlug: string,
    id: string,
    dto: UpdateBrewGuideDto,
  ) {
    const existing = await this.ensure(tenantId, id);
    if (dto.slug && dto.slug !== existing.slug) {
      await this.assertSlugFree(tenantId, dto.slug);
    }
    const touchesBody =
      dto.summary !== undefined ||
      dto.totalTime !== undefined ||
      dto.difficulty !== undefined ||
      dto.steps !== undefined;

    const guide = await this.prisma.brewGuide.update({
      where: { id: existing.id },
      data: {
        ...(dto.title !== undefined && { title: dto.title.trim() }),
        ...(dto.slug !== undefined && { slug: dto.slug }),
        ...(dto.method !== undefined && { method: emptyToNull(dto.method) }),
        ...(dto.coverUrl !== undefined && {
          coverUrl: emptyToNull(dto.coverUrl),
        }),
        ...(touchesBody && {
          body: serializeBrewGuideBody(
            this.content(dto, parseBrewGuideBody(existing.body)),
          ),
        }),
      },
    });
    this.revalidate(tenantSlug, [existing.slug, guide.slug]);
    return toBrewGuideView(guide);
  }

  async remove(tenantId: string, tenantSlug: string, id: string) {
    const existing = await this.ensure(tenantId, id);
    await this.prisma.brewGuide.delete({ where: { id: existing.id } });
    this.revalidate(tenantSlug, [existing.slug]);
    return { id: existing.id, deleted: true };
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  /** Mezcla lo recibido sobre lo existente (en alta, sobre valores vacíos). */
  private content(
    dto: UpdateBrewGuideDto,
    base: BrewGuideContent = {
      summary: '',
      totalTime: '',
      difficulty: 'Media',
      steps: [],
    },
  ): BrewGuideContent {
    return {
      summary: dto.summary?.trim() ?? base.summary,
      totalTime: dto.totalTime?.trim() ?? base.totalTime,
      difficulty: dto.difficulty ?? base.difficulty,
      steps: dto.steps
        ? dto.steps.map((s) => ({
            title: s.title.trim(),
            body: s.body?.trim() ?? '',
            durationSec: s.durationSec ?? 0,
          }))
        : base.steps,
    };
  }

  private async ensure(tenantId: string, id: string) {
    const guide = await this.prisma.brewGuide.findFirst({
      where: { id, tenantId },
    });
    if (!guide) throw new NotFoundException('Guía no encontrada');
    return guide;
  }

  private async slugTaken(tenantId: string, slug: string) {
    const clash = await this.prisma.brewGuide.findUnique({
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
      'brew-guides',
      ...new Set(slugs.map((s) => `brew-guide:${s}`)),
    ]);
  }
}

function emptyToNull(value: string | undefined): string | null {
  const v = value?.trim();
  return v ? v : null;
}
