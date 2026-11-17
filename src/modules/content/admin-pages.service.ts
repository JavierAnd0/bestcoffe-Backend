import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RevalidationService } from '../revalidation/revalidation.service';
import {
  EditorialPageContentDto,
  SaveEditorialPageDto,
} from './dto/editorial-page.dto';
import {
  EDITORIAL_PAGE_SLUGS,
  type EditorialPageContent,
  type EditorialPageSlug,
  isContentPageSlug,
  isEditorialPageSlug,
  storedPageContent,
  storedPageFlags,
} from './editorial-pages';

export interface AdminEditorialPage {
  slug: EditorialPageSlug;
  /** `content`: la tienda escribe su texto · `toggle`: solo se activa (sedes). */
  kind: 'content' | 'toggle';
  /** Valor guardado en `branding.pages` (el mismo que ve el superadmin). */
  active: boolean;
  /** Lo que ve la tienda: activa y, si es de contenido, con contenido. */
  live: boolean;
  content: EditorialPageContent | null;
}

type Json = Record<string, unknown>;
const asObject = (v: unknown): Json =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {};

/** Recorta textos y quita los vacíos: no se guardan claves sin valor. */
function clean(v: string | undefined): string | undefined {
  const t = v?.trim();
  return t ? t : undefined;
}

function compact<T extends object>(obj: T): T | undefined {
  const out = Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as T;
  return Object.keys(out).length ? out : undefined;
}

/** Contenido saneado listo para guardar. Lanza 400 si es incoherente. */
export function normalizePageContent(
  dto: EditorialPageContentDto,
): EditorialPageContent {
  const sections = (dto.sections ?? [])
    .map((s) =>
      compact({
        title: clean(s.title),
        body: s.body?.replace(/\r\n/g, '\n').trim() || undefined,
        imageUrl: clean(s.imageUrl),
        imageAlt: clean(s.imageAlt),
      }),
    )
    .filter((s): s is NonNullable<typeof s> => !!s)
    // Un texto alternativo sin imagen no es una sección.
    .filter((s) => s.title || s.body || s.imageUrl);

  const cta = dto.cta
    ? compact({
        title: clean(dto.cta.title),
        body: clean(dto.cta.body),
        label: clean(dto.cta.label),
        href: clean(dto.cta.href),
        secondaryLabel: clean(dto.cta.secondaryLabel),
        secondaryHref: clean(dto.cta.secondaryHref),
      })
    : undefined;
  if (cta && !cta.label !== !cta.href) {
    throw new BadRequestException('El botón necesita texto y enlace');
  }
  if (cta && !cta.secondaryLabel !== !cta.secondaryHref) {
    throw new BadRequestException('El segundo botón necesita texto y enlace');
  }

  const highlights = (dto.highlights ?? [])
    .map((h) => ({ value: h.value.trim(), label: h.label.trim() }))
    .filter((h) => h.value && h.label);

  const title = dto.title.trim();
  if (!title) throw new BadRequestException('La página necesita un título');

  return {
    ...compact({
      eyebrow: clean(dto.eyebrow),
      intro: clean(dto.intro),
      imageUrl: clean(dto.imageUrl),
      imageAlt: clean(dto.imageAlt),
      imageCaption: clean(dto.imageCaption),
      sectionsEyebrow: clean(dto.sectionsEyebrow),
      sectionsTitle: clean(dto.sectionsTitle),
    }),
    title,
    ...(highlights.length && { highlights }),
    sections,
    ...(cta && { cta }),
    ...(dto.contact && {
      contact: compact({
        email: clean(dto.contact.email),
        phone: clean(dto.contact.phone),
      }),
    }),
  };
}

@Injectable()
export class AdminPagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly revalidation: RevalidationService,
  ) {}

  async list(tenantId: string): Promise<AdminEditorialPage[]> {
    const branding = await this.branding(tenantId);
    return EDITORIAL_PAGE_SLUGS.map((slug) => this.view(branding, slug));
  }

  async findOne(tenantId: string, slug: string): Promise<AdminEditorialPage> {
    const page = this.assertSlug(slug);
    return this.view(await this.branding(tenantId), page);
  }

  /**
   * Guarda el contenido y/o activa la página. Activar escribe
   * `branding.pages[slug]`, la misma clave que usa el superadmin.
   */
  async save(
    tenantId: string,
    tenantSlug: string,
    slug: string,
    dto: SaveEditorialPageDto,
  ): Promise<AdminEditorialPage> {
    const page = this.assertSlug(slug);
    if (dto.active === undefined && dto.content === undefined) {
      throw new BadRequestException('No hay cambios que guardar');
    }
    if (dto.content !== undefined && !isContentPageSlug(page)) {
      throw new BadRequestException(
        'Esta página no tiene texto propio: solo se activa o desactiva',
      );
    }

    const branding = await this.branding(tenantId);
    const next: Json = { ...branding };

    if (dto.content !== undefined && isContentPageSlug(page)) {
      next.editorialPages = {
        ...asObject(branding.editorialPages),
        [page]: {
          ...normalizePageContent(dto.content),
          updatedAt: new Date().toISOString(),
        },
      };
    }

    if (dto.active !== undefined) {
      if (
        dto.active &&
        isContentPageSlug(page) &&
        !storedPageContent(next, page)
      ) {
        throw new BadRequestException(
          'Escribe el contenido de la página antes de activarla',
        );
      }
      next.pages = { ...asObject(branding.pages), [page]: dto.active };
    }

    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { branding: next as Prisma.InputJsonValue },
    });

    // `settings`: menús, sitemap y llms.txt leen las páginas activas del
    // perfil de la tienda; `pages`/`page:<slug>`: el contenido cacheado.
    this.revalidation.dispatch(tenantSlug, [
      'settings',
      'pages',
      `page:${page}`,
    ]);
    return this.view(next, page);
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private assertSlug(slug: string): EditorialPageSlug {
    if (!isEditorialPageSlug(slug)) {
      throw new NotFoundException('Página no encontrada');
    }
    return slug;
  }

  private async branding(tenantId: string): Promise<Json> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { branding: true },
    });
    if (!tenant) throw new NotFoundException('Tenant no encontrado');
    return asObject(tenant.branding);
  }

  private view(branding: Json, slug: EditorialPageSlug): AdminEditorialPage {
    const active = storedPageFlags(branding)[slug] === true;
    if (!isContentPageSlug(slug)) {
      return { slug, kind: 'toggle', active, live: active, content: null };
    }
    const content = storedPageContent(branding, slug);
    return {
      slug,
      kind: 'content',
      active,
      live: active && content !== null,
      content,
    };
  }
}
