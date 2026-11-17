/**
 * Páginas editoriales por tienda (historia, impacto, sostenibilidad, mayoristas)
 * y el interruptor de la página de sedes (`tiendas`).
 *
 * Se guardan en `Tenant.branding` (JSON) para no exigir una migración:
 *   branding.pages[slug]           → activada o no (la misma clave que ya usa el
 *                                    superadmin: una sola fuente de verdad)
 *   branding.editorialPages[slug]  → el contenido escrito por la tienda
 *
 * El perfil público de la tienda nunca expone `editorialPages` (se lee por
 * `GET /v1/content/pages/:slug`) y publica en `pages` el valor EFECTIVO: una
 * página con contenido solo cuenta como activa si además tiene contenido, para
 * que menús, sitemap y llms.txt nunca enlacen a una página vacía.
 */

/** Páginas con contenido propio que escribe la tienda. */
export const CONTENT_PAGE_SLUGS = [
  'historia',
  'impacto',
  'sostenibilidad',
  'mayoristas',
] as const;
export type ContentPageSlug = (typeof CONTENT_PAGE_SLUGS)[number];

/** Páginas que solo se activan o desactivan (su contenido vive en otro módulo). */
export const TOGGLE_PAGE_SLUGS = ['tiendas'] as const;
export type TogglePageSlug = (typeof TOGGLE_PAGE_SLUGS)[number];

export type EditorialPageSlug = ContentPageSlug | TogglePageSlug;
export const EDITORIAL_PAGE_SLUGS: readonly EditorialPageSlug[] = [
  ...CONTENT_PAGE_SLUGS,
  ...TOGGLE_PAGE_SLUGS,
];

export const isEditorialPageSlug = (s: string): s is EditorialPageSlug =>
  (EDITORIAL_PAGE_SLUGS as readonly string[]).includes(s);

export const isContentPageSlug = (s: string): s is ContentPageSlug =>
  (CONTENT_PAGE_SLUGS as readonly string[]).includes(s);

export interface EditorialPageContent {
  eyebrow?: string;
  title: string;
  intro?: string;
  imageUrl?: string;
  imageAlt?: string;
  imageCaption?: string;
  highlights?: { value: string; label: string }[];
  sectionsEyebrow?: string;
  sectionsTitle?: string;
  sections: {
    title?: string;
    body?: string;
    imageUrl?: string;
    imageAlt?: string;
  }[];
  cta?: {
    title?: string;
    body?: string;
    label?: string;
    href?: string;
    secondaryLabel?: string;
    secondaryHref?: string;
  };
  contact?: { email?: string; phone?: string };
  updatedAt?: string;
}

type Json = Record<string, unknown>;

const asObject = (v: unknown): Json =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {};

/** Banderas guardadas (`branding.pages`), solo las booleanas. */
export function storedPageFlags(
  branding: unknown,
): Partial<Record<EditorialPageSlug, boolean>> {
  const pages = asObject(asObject(branding).pages);
  const out: Partial<Record<EditorialPageSlug, boolean>> = {};
  for (const slug of EDITORIAL_PAGE_SLUGS) {
    if (typeof pages[slug] === 'boolean') out[slug] = pages[slug];
  }
  return out;
}

/** Contenido guardado de una página, o null si no hay (o está incompleto). */
export function storedPageContent(
  branding: unknown,
  slug: ContentPageSlug,
): EditorialPageContent | null {
  const all = asObject(asObject(branding).editorialPages);
  const page = asObject(all[slug]);
  if (typeof page.title !== 'string' || !page.title.trim()) return null;
  return {
    ...(page as unknown as EditorialPageContent),
    sections: Array.isArray(page.sections)
      ? (page.sections as EditorialPageContent['sections'])
      : [],
  };
}

/**
 * Branding tal como lo ve la tienda pública: sin el contenido de las páginas y
 * con `pages` efectivas (las de contenido, solo si lo tienen).
 */
export function publicBranding(branding: unknown): Json {
  const raw = asObject(branding);
  const { editorialPages: _omit, ...rest } = raw;
  void _omit;
  const pages: Json = { ...asObject(raw.pages) };
  for (const slug of CONTENT_PAGE_SLUGS) {
    pages[slug] = pages[slug] === true && storedPageContent(raw, slug) !== null;
  }
  return { ...rest, pages };
}
