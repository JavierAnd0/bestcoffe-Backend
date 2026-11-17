/**
 * Utilidades de slug para el contenido editorial por tienda (blog, guías).
 * Los slugs son únicos por tienda (`@@unique([tenantId, slug])`), así que la
 * comprobación de disponibilidad la hace cada servicio con su propio modelo.
 */

/** Formato admitido: minúsculas, números y guiones simples (`mi-articulo-2`). */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Deriva un slug legible de un texto libre ("Café de Huila" → "cafe-de-huila"). */
export function slugify(text: string, fallback: string): string {
  return (
    text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 100)
      .replace(/-$/, '') || fallback
  );
}

/**
 * Primer slug libre a partir de `base`: `base`, `base-2`, `base-3`…
 * `taken` consulta la base filtrando SIEMPRE por la tienda.
 */
export async function firstFreeSlug(
  base: string,
  taken: (slug: string) => Promise<boolean>,
): Promise<string> {
  let slug = base;
  let n = 1;
  while (await taken(slug)) {
    slug = `${base}-${++n}`;
  }
  return slug;
}
