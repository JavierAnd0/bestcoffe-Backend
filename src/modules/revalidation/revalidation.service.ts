import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Dispara revalidación ISR en el front. Tras una mutación admin que afecte al
 * storefront, el API pega a `WEB_REVALIDATE_URL` con un secret compartido y el
 * front ejecuta `revalidateTag(...)`. Fire-and-forget: nunca bloquea la
 * respuesta admin ni la rompe si el front está caído.
 *
 * Convención de tags (debe coincidir con el front):
 *   products            → catálogo
 *   product:<slug>      → PDP
 *   collections         → listado de colecciones
 *   collection:<slug>   → colección
 *   content             → home
 *   blog · blog:<slug>  → blog
 */
@Injectable()
export class RevalidationService {
  private readonly logger = new Logger(RevalidationService.name);
  private readonly url?: string;
  private readonly secret?: string;

  constructor(config: ConfigService) {
    this.url = config.get<string>('revalidate.webUrl') || undefined;
    this.secret = config.get<string>('revalidate.secret') || undefined;
  }

  /** Revalida los tags indicados en el front del tenant (por slug). */
  dispatch(tenantSlug: string, tags: string[]): void {
    if (!this.url || tags.length === 0) return;

    void fetch(this.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-revalidate-secret': this.secret ?? '',
        'x-tenant-slug': tenantSlug,
      },
      body: JSON.stringify({ tenantSlug, tags }),
    })
      .then((res) => {
        if (!res.ok) {
          this.logger.warn(
            `Revalidación respondió ${res.status} para [${tags.join(', ')}]`,
          );
        }
      })
      .catch((err) =>
        this.logger.warn(`No se pudo revalidar el front: ${err.message}`),
      );
  }
}
