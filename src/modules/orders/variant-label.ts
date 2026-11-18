import type { GrindFormat, ProductType } from '@prisma/client';

const GRIND_LABEL: Record<GrindFormat, string> = {
  WHOLE_BEAN: 'Grano',
  ESPRESSO: 'Espresso',
  FILTER: 'Filtro',
  FRENCH_PRESS: 'Prensa',
};

/**
 * Texto de la variante para el cliente: "340 g · Grano", "1 kg · Espresso".
 * Un accesorio no tiene peso ni molido que mostrar: "Accesorio".
 */
export function variantLabel(v: {
  sizeGrams: number;
  grind: GrindFormat;
  productType?: ProductType | null;
}): string {
  if (v.productType === 'ACCESSORY') return 'Accesorio';
  const size =
    v.sizeGrams >= 1000 ? `${v.sizeGrams / 1000} kg` : `${v.sizeGrams} g`;
  return `${size} · ${GRIND_LABEL[v.grind] ?? v.grind}`;
}
