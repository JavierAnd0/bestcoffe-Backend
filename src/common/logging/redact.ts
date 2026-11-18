/**
 * Campos que nunca deben quedar en claro en los registros de peticiones.
 *
 * pino-http registra todas las cabeceras de la petición y de la respuesta.
 * Además de `authorization`, las credenciales viajan en:
 * - `cookie`: la sesión del cliente (`customer_token`), que el front reenvía y
 *   el navegador manda directo al API;
 * - `x-internal-secret` / `x-revalidate-secret`: el secreto compartido entre el
 *   front y el API (autoriza neon-sync, pedidos de invitado, revalidación…);
 * - `x-client-ip-sig`: la firma de la IP del visitante, hecha con ese secreto;
 * - `set-cookie` de la respuesta: la sesión recién emitida al iniciar sesión.
 */
export const LOG_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-internal-secret"]',
  'req.headers["x-revalidate-secret"]',
  'req.headers["x-client-ip-sig"]',
  'res.headers["set-cookie"]',
];

export const LOG_REDACT = { paths: LOG_REDACT_PATHS, censor: '[REDACTED]' };
