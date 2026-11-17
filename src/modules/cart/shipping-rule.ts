const DEFAULT_FREE_SHIPPING_THRESHOLD = 150_000 * 100;
const DEFAULT_SHIPPING_FLAT = 12_000 * 100;

/**
 * Regla de envío de la tienda (guardada en `features` desde Configuración).
 * La usan el cálculo del carrito y el perfil público, para que el front
 * muestre exactamente lo que se cobra.
 */
export function resolveShippingRule(features: unknown): {
  freeShippingThresholdCents: number;
  shippingFlatCents: number;
} {
  const f = (features ?? {}) as Record<string, unknown>;
  const num = (v: unknown, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback;
  return {
    freeShippingThresholdCents: num(
      f.freeShippingThresholdCents,
      DEFAULT_FREE_SHIPPING_THRESHOLD,
    ),
    shippingFlatCents: num(f.shippingFlatCents, DEFAULT_SHIPPING_FLAT),
  };
}
