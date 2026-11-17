import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * IP del visitante reenviada por el front.
 *
 * El front (Next) llama a la API desde su servidor: sin esto, todas las
 * peticiones de todos los visitantes comparten la IP del servidor de Next y
 * los límites por IP (5 inicios de sesión/min, 5 reseñas/min…) se vuelven
 * globales para toda la tienda.
 *
 * El front firma la IP con el secreto interno compartido (`REVALIDATE_SECRET`)
 * y la API solo la acepta si la firma es válida, así que un cliente que llama
 * directo a la API no puede elegir su propia IP. Formato de las cabeceras:
 *
 *   x-client-ip      IP del visitante, o vacía si la petición no tiene visitante
 *                    (render en segundo plano, caché de datos)
 *   x-client-ip-ts   segundos Unix de la firma; "0" cuando la IP va vacía (así la
 *                    cabecera es constante y no rompe la caché de `fetch` de Next)
 *   x-client-ip-sig  HMAC-SHA256 hex de `${ts}.${ip}`
 */
export const CLIENT_IP_HEADER = 'x-client-ip';
export const CLIENT_IP_TS_HEADER = 'x-client-ip-ts';
export const CLIENT_IP_SIG_HEADER = 'x-client-ip-sig';

/** Margen para la hora de la firma (relojes desfasados, reintentos). */
export const CLIENT_IP_MAX_SKEW_SECONDS = 300;

export function signClientIp(secret: string, ip: string, ts: string): string {
  return createHmac('sha256', secret).update(`${ts}.${ip}`).digest('hex');
}

export type ClientIpVerification =
  | { valid: false }
  /** `ip` vacía = petición del servidor del front sin visitante. */
  | { valid: true; ip: string };

const IP_RE = /^[0-9a-fA-F:.]{2,45}$/;

function header(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const v = headers[name];
  return Array.isArray(v) ? v[0] : v;
}

export function verifyClientIp(
  secret: string,
  headers: Record<string, string | string[] | undefined>,
  nowSeconds = Math.floor(Date.now() / 1000),
): ClientIpVerification {
  if (!secret) return { valid: false };
  const sig = header(headers, CLIENT_IP_SIG_HEADER);
  const ts = header(headers, CLIENT_IP_TS_HEADER);
  if (!sig || ts === undefined) return { valid: false };
  const ip = (header(headers, CLIENT_IP_HEADER) ?? '').trim();

  if (ip) {
    if (!IP_RE.test(ip)) return { valid: false };
    const t = Number(ts);
    if (!Number.isInteger(t)) return { valid: false };
    if (Math.abs(nowSeconds - t) > CLIENT_IP_MAX_SKEW_SECONDS) {
      return { valid: false };
    }
  } else if (ts !== '0') {
    return { valid: false };
  }

  const expected = Buffer.from(signClientIp(secret, ip, ts), 'hex');
  let given: Buffer;
  try {
    given = Buffer.from(sig, 'hex');
  } catch {
    return { valid: false };
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { valid: false };
  }
  return { valid: true, ip };
}
