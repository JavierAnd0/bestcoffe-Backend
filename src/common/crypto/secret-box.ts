import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from 'node:crypto';

/**
 * Cifrado de secretos en reposo (AES-256-GCM) para valores que deben poder
 * leerse de vuelta, como los tokens OAuth de MercadoPago de cada tienda. Si la
 * base de datos se filtra, los tokens no sirven sin la clave del servidor.
 *
 * Formato: `enc:v1:<iv>.<etiqueta>.<cifrado>` en base64url. Un valor sin ese
 * prefijo se considera texto plano heredado y se devuelve tal cual, de modo
 * que las tiendas ya conectadas siguen funcionando y se cifran solas en el
 * siguiente refresco del token.
 */
const PREFIX = 'enc:v1:';

/**
 * Clave de 32 bytes. Usa TOKEN_ENCRYPTION_KEY si existe; si no, se deriva de
 * JWT_SECRET (misma técnica que el secreto de tokens de cliente), para no
 * exigir una variable nueva. OJO: cambiar el secreto del que sale la clave
 * invalida los tokens guardados y obliga a reconectar MercadoPago.
 */
export function deriveSecretBoxKey(
  env: NodeJS.ProcessEnv = process.env,
): Buffer {
  const base = env.TOKEN_ENCRYPTION_KEY || env.JWT_SECRET || '';
  return createHmac('sha256', base).update('bestcoffee:secret-box:v1').digest();
}

export function isSealed(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

export function seal(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return (
    PREFIX + [iv, tag, data].map((part) => part.toString('base64url')).join('.')
  );
}

/** Descifra un valor sellado; devuelve tal cual uno heredado en texto plano. */
export function open(value: string, key: Buffer): string {
  if (!isSealed(value)) return value;
  const [iv, tag, data] = value
    .slice(PREFIX.length)
    .split('.')
    .map((part) => Buffer.from(part, 'base64url'));
  if (!iv || !tag || !data)
    throw new Error('Secreto cifrado con formato inválido');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    'utf8',
  );
}
