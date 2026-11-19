import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../prisma/prisma.service';

/** Origen (`https://host[:puerto]`) de una URL http(s), o null si no lo es. */
export function safeOrigin(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.origin;
  } catch {
    return null;
  }
}

/**
 * Base de la URL de regreso a la confirmación del pedido, tras pagar en una
 * pasarela externa (MercadoPago, ePayco). Solo se acepta un origen que sea la
 * web de la plataforma o un dominio verificado de la tienda (en local, también
 * localhost); en otro caso se usa la web de la plataforma. Así nadie puede
 * usar el checkout para redirigir al comprador a un sitio ajeno.
 */
export async function checkoutReturnBase(
  prisma: PrismaService,
  config: ConfigService,
  tenantId: string,
  orderId: string,
  requested?: string,
): Promise<string> {
  const webUrl = config.get<string>('webAppUrl') ?? '';
  let origin = safeOrigin(webUrl) ?? '';
  const asked = requested ? safeOrigin(requested) : null;
  if (asked && asked !== origin) {
    const host = new URL(asked).hostname;
    const isLocal =
      config.get<string>('nodeEnv') !== 'production' &&
      (host === 'localhost' ||
        host === '127.0.0.1' ||
        host.endsWith('.localhost'));
    const domain = isLocal
      ? null
      : await prisma.tenantDomain.findFirst({
          where: { tenantId, domain: host, verified: true },
          select: { id: true },
        });
    if (isLocal || domain) origin = asked;
  }
  return `${origin}/checkout/confirmacion?orderId=${encodeURIComponent(orderId)}`;
}
