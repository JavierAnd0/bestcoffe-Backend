import { Tier } from '@prisma/client';

/**
 * Catálogo de capacidades de la plataforma. Cada tienda (tenant) tiene un `tier`
 * que define qué puede usar. El modelo de negocio:
 *
 *  - STARTER  → presencia web: landing + blog + catálogo de solo lectura
 *               (muestra productos y precios, pero NO se puede comprar).
 *  - PRO      → tienda transaccional: carrito, checkout, cuentas de cliente,
 *               suscripciones y descuentos.
 *  - BUSINESS → todo PRO + regalos + dominio propio + sin límite de productos.
 *
 * El cobro al tenant (pago único + mantenimiento, o suscripción mensual/anual)
 * es un acuerdo comercial externo; el sistema solo necesita el `tier` activo.
 */
export type FeatureFlags = {
  // Presencia (todos los tiers)
  blog: boolean;
  catalog: boolean; // navegar productos + ver precios

  // Transaccional (PRO+)
  checkout: boolean; // carrito + compra
  customerAccounts: boolean; // registro/login de clientes
  subscriptions: boolean; // suscripciones de café
  discountCodes: boolean; // códigos de descuento
  reviews: boolean; // reseñas de clientes

  // Premium (BUSINESS)
  gifts: boolean; // tarjetas de regalo / regalar suscripción
  customDomain: boolean; // dominio propio

  // Límites numéricos (-1 = ilimitado)
  maxProducts: number;
};

export type FeatureKey = keyof FeatureFlags;

/** Capacidades booleanas que un guard puede exigir con @RequireFeature. */
export type BooleanFeatureKey = {
  [K in FeatureKey]: FeatureFlags[K] extends boolean ? K : never;
}[FeatureKey];

export const TIER_FEATURES: Record<Tier, FeatureFlags> = {
  STARTER: {
    blog: true,
    catalog: true,
    checkout: false,
    customerAccounts: false,
    subscriptions: false,
    discountCodes: false,
    reviews: false,
    gifts: false,
    customDomain: false,
    maxProducts: 10,
  },
  PRO: {
    blog: true,
    catalog: true,
    checkout: true,
    customerAccounts: true,
    subscriptions: true,
    discountCodes: true,
    reviews: true,
    gifts: false,
    customDomain: false,
    maxProducts: 50,
  },
  BUSINESS: {
    blog: true,
    catalog: true,
    checkout: true,
    customerAccounts: true,
    subscriptions: true,
    discountCodes: true,
    reviews: true,
    gifts: true,
    customDomain: true,
    maxProducts: -1,
  },
};

/**
 * Resuelve las features efectivas de un tenant: el tier define la base, y la
 * columna `features` (JSON) permite overrides puntuales por tenant (p.ej. activar
 * `gifts` a un PRO como cortesía sin subirle el tier). Solo se aplican claves
 * conocidas y del tipo correcto; el resto se ignora.
 */
export function resolveFeatures(
  tier: Tier,
  overrides?: unknown,
): FeatureFlags {
  const base = TIER_FEATURES[tier];
  if (!overrides || typeof overrides !== 'object') return { ...base };

  const result = { ...base };
  const o = overrides as Record<string, unknown>;
  for (const key of Object.keys(base) as FeatureKey[]) {
    const val = o[key];
    if (typeof base[key] === 'boolean' && typeof val === 'boolean') {
      (result[key] as boolean) = val;
    } else if (typeof base[key] === 'number' && typeof val === 'number') {
      (result[key] as number) = val;
    }
  }
  return result;
}
