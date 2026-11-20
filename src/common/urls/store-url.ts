import type { ConfigService } from '@nestjs/config';

/** WEB_APP_URL sin barra final: la web de la plataforma. */
export function platformUrl(config?: ConfigService | null): string {
  return (
    config?.get<string>('webAppUrl') ??
    process.env.WEB_APP_URL ??
    'http://localhost:3000'
  ).replace(/\/+$/, '');
}

/** Dominio raíz de la plataforma (tiendas en `<slug>.<dominio>`), o null. */
export function platformDomain(): string | null {
  return process.env.PLATFORM_DOMAIN?.trim().toLowerCase() || null;
}

/**
 * URL pública de una tienda: `https://<slug>.<PLATFORM_DOMAIN>` si la
 * plataforma tiene dominio propio; si no (deploy de una sola tienda, local),
 * la web de la plataforma. Todo enlace que lleve a una tienda (correos,
 * regreso del checkout) sale de aquí: con WEB_APP_URL apuntando al dominio
 * raíz, `bestkofi.com/acceso` es la landing, no el panel de la tienda.
 */
export function storeUrl(
  slug: string | null | undefined,
  config?: ConfigService | null,
): string {
  const domain = platformDomain();
  if (domain && slug) return `https://${slug}.${domain}`;
  return platformUrl(config);
}
