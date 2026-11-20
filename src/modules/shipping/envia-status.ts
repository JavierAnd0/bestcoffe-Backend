import { createHmac, timingSafeEqual } from 'node:crypto';
import { ShipmentStatus } from '@prisma/client';

/**
 * Traducción de los estados de Envia.com a los de Bestkofi y verificación de
 * la firma de sus webhooks. Funciones puras: se prueban sin red ni base.
 */

/** Catálogo de estados de Envia (id → nombre), según su referencia de tracking. */
const ENVIA_STATUS_BY_ID: Record<number, string> = {
  1: 'created',
  2: 'shipped',
  3: 'delivered',
  4: 'canceled',
  5: 'information',
  6: 'n/a',
  7: 'pending',
  8: 'picked up',
  9: 'out for delivery',
  10: 'lost',
  11: 'returned',
  12: 'pickup at office',
  13: 'delivered at origin',
  14: 'damaged',
  15: 'redirected',
  16: 'out for pickup',
  17: '1 delivery attempt',
  18: '2 delivery attempts',
  19: '3 delivery attempts',
  20: 'return problem',
  21: 'address error',
  22: 'undeliverable',
  23: 'delayed',
  24: 'rejected',
  25: '1 pickup attempt',
  26: 'partially shipped',
  27: 'partially delivered',
  28: 'delivery attempt',
};

const LABEL_CREATED = new Set([
  'created',
  'pending',
  'out for pickup',
  '1 pickup attempt',
]);
const DELIVERED = new Set(['delivered', 'partially delivered']);
const CANCELLED = new Set(['canceled', 'cancelled']);
const EXCEPTION = new Set([
  'lost',
  'returned',
  'delivered at origin',
  'damaged',
  'return problem',
  'address error',
  'undeliverable',
  'rejected',
]);
/** Estados informativos: no dicen nada nuevo del paquete, no cambian nada. */
const NEUTRAL = new Set(['information', 'n/a', '']);

/** Normaliza el estado que manda Envia (nombre, id numérico o texto con mayúsculas). */
export function normalizeEnviaStatus(raw: unknown): string {
  if (typeof raw === 'number') return ENVIA_STATUS_BY_ID[raw] ?? '';
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) return ENVIA_STATUS_BY_ID[Number(trimmed)] ?? '';
  return trimmed.toLowerCase().replace(/[_-]+/g, ' ');
}

/**
 * Estado de la guía según Envia, o `null` si el aviso es informativo y la
 * guía debe quedar como está. Cualquier estado desconocido que no sea de
 * creación cuenta como "en camino": la transportadora ya lo tiene.
 */
export function mapEnviaStatus(raw: unknown): ShipmentStatus | null {
  const s = normalizeEnviaStatus(raw);
  if (NEUTRAL.has(s)) return null;
  if (LABEL_CREATED.has(s)) return ShipmentStatus.LABEL_CREATED;
  if (DELIVERED.has(s)) return ShipmentStatus.DELIVERED;
  if (CANCELLED.has(s)) return ShipmentStatus.CANCELLED;
  if (EXCEPTION.has(s)) return ShipmentStatus.EXCEPTION;
  return ShipmentStatus.IN_TRANSIT;
}

/** Guías que siguen vivas: se consultan en el job y aceptan avisos. */
export const OPEN_SHIPMENT_STATUSES: ShipmentStatus[] = [
  ShipmentStatus.LABEL_CREATED,
  ShipmentStatus.IN_TRANSIT,
  ShipmentStatus.EXCEPTION,
];

/** Ventana para aceptar un aviso firmado (protege contra reenvíos viejos). */
export const WEBHOOK_TOLERANCE_MS = 10 * 60 * 1000;

/**
 * Verifica `X-Webhook-Signature` de Envia:
 * `v1=HMAC_SHA256(secret, timestamp + "." + event + "." + body)`.
 *
 * La documentación no dice si el resumen va en hex o base64 ni si el
 * timestamp va en segundos o milisegundos, así que se aceptan ambas formas.
 * La comparación es en tiempo constante.
 */
export function verifyEnviaSignature(opts: {
  secret: string;
  signature: string | undefined;
  timestamp: string | undefined;
  event: string | undefined;
  rawBody: string;
  now?: number;
}): boolean {
  const { secret, signature, timestamp, event, rawBody } = opts;
  if (!secret || !signature || !timestamp || !event) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const tsMs = ts < 1e12 ? ts * 1000 : ts;
  const now = opts.now ?? Date.now();
  if (Math.abs(now - tsMs) > WEBHOOK_TOLERANCE_MS) return false;

  const provided = signature
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.startsWith('v1='))
    .map((part) => part.slice(3));
  if (provided.length === 0) return false;

  const digest = createHmac('sha256', secret)
    .update(`${timestamp}.${event}.${rawBody}`)
    .digest();
  const expected = [digest.toString('hex'), digest.toString('base64')];

  return provided.some((candidate) =>
    expected.some((exp) => safeEqual(candidate, exp)),
  );
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Quita tildes y mayúsculas para comparar nombres de departamentos y ciudades. */
export function normalizePlaceName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z ]/g, ' ')
    .replace(/\b(departamento|depto|distrito capital|d c|dc)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Peso del paquete en kg: el café (gramos de cada bolsa por cantidad) más el
 * empaque, redondeado hacia arriba a 0,1 kg y nunca menos de 1 kg (el mínimo
 * que cobran las transportadoras en Colombia).
 */
export function packageWeightKg(
  items: { sizeGrams: number; quantity: number }[],
  packagingGrams: number,
): number {
  const grams =
    items.reduce((sum, i) => sum + i.sizeGrams * i.quantity, 0) +
    packagingGrams;
  return Math.max(1, Math.ceil(grams / 100) / 10);
}
