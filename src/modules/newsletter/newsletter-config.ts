import type { PrismaClient } from '@prisma/client';

/**
 * Configuración de newsletter de un tenant. Vive en `Tenant.features.newsletter`
 * (ajustes operativos editables por el dueño de la tienda, no del plan).
 *
 *  - popupEnabled: muestra la invitación discreta a visitantes sin sesión.
 *  - welcomeCode:  código de descuento de bienvenida (debe existir y estar
 *                  vigente; si no lo está, simplemente no se promociona).
 */
export interface NewsletterConfig {
  popupEnabled: boolean;
  welcomeCode: string | null;
}

export interface WelcomeOffer {
  code: string;
  /** Texto legible en español: "10% de descuento", "$ 15.000 de descuento"… */
  label: string;
}

export interface PublicNewsletterConfig {
  popupEnabled: boolean;
  welcomeOffer: WelcomeOffer | null;
}

export const DEFAULT_NEWSLETTER_CONFIG: NewsletterConfig = {
  popupEnabled: true,
  welcomeCode: null,
};

/** Lee `features.newsletter` tolerando JSON ausente o mal formado. */
export function readNewsletterConfig(rawFeatures: unknown): NewsletterConfig {
  const raw =
    rawFeatures && typeof rawFeatures === 'object'
      ? (rawFeatures as Record<string, unknown>).newsletter
      : undefined;
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_NEWSLETTER_CONFIG };
  const r = raw as Record<string, unknown>;
  return {
    popupEnabled:
      typeof r.popupEnabled === 'boolean'
        ? r.popupEnabled
        : DEFAULT_NEWSLETTER_CONFIG.popupEnabled,
    welcomeCode:
      typeof r.welcomeCode === 'string' && r.welcomeCode.trim()
        ? r.welcomeCode.trim().toUpperCase()
        : null,
  };
}

function formatCop(cents: number): string {
  const pesos = Math.round(cents / 100);
  return `$ ${pesos.toLocaleString('es-CO')}`;
}

/**
 * Resuelve la oferta de bienvenida SOLO si el código existe, está activo y
 * vigente ahora. Así nunca se promociona un cupón que luego no funcione.
 */
export async function resolveWelcomeOffer(
  prisma: Pick<PrismaClient, 'discountCode'>,
  tenantId: string,
  code: string | null,
  now: Date = new Date(),
): Promise<WelcomeOffer | null> {
  if (!code) return null;
  const dc = await prisma.discountCode.findUnique({
    where: { tenantId_code: { tenantId, code } },
  });
  if (!dc || !dc.active) return null;
  if (dc.startsAt && dc.startsAt > now) return null;
  if (dc.endsAt && dc.endsAt < now) return null;
  if (dc.maxRedemptions != null && dc.timesRedeemed >= dc.maxRedemptions) {
    return null;
  }
  const label =
    dc.type === 'PERCENTAGE'
      ? `${dc.value}% de descuento`
      : `${formatCop(dc.value)} de descuento`;
  return { code: dc.code, label };
}

export async function resolvePublicNewsletterConfig(
  prisma: Pick<PrismaClient, 'discountCode'>,
  tenantId: string,
  rawFeatures: unknown,
): Promise<PublicNewsletterConfig> {
  const cfg = readNewsletterConfig(rawFeatures);
  return {
    popupEnabled: cfg.popupEnabled,
    welcomeOffer: await resolveWelcomeOffer(prisma, tenantId, cfg.welcomeCode),
  };
}
