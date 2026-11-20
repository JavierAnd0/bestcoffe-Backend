import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { platformUrl, storeUrl } from '../../common/urls/store-url';
import {
  MailBrand,
  PLATFORM_NAME,
  p,
  receipt,
  renderEmail,
  strong,
} from './layout';

export type SubscriptionChange =
  'paused' | 'resumed' | 'skipped' | 'cancelled' | 'frequency';

/**
 * Escapa texto antes de meterlo en el HTML de un correo. Todo lo variable
 * (nombres, productos, tienda, rol) pasa por aquí: un nombre lo puede escribir
 * cualquiera al registrarse, y sin escapar permitía meter enlaces o esconder
 * el contenido real del correo.
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const esc = escapeHtml;

/** "Hola <nombre>" con el nombre escapado (o solo "Hola"). */
function greeting(name: string | null | undefined): string {
  return name ? `Hola ${esc(name)}` : 'Hola';
}

/**
 * Valor seguro para un href: solo http(s), escapado para el atributo. Una URL
 * con otro esquema (javascript:, data:…) devuelve null y el enlace se omite.
 */
export function safeHref(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return esc(u.toString());
  } catch {
    return null;
  }
}

const money = (cents: number) => `$${(cents / 100).toLocaleString('es-CO')}`;
const shortId = (orderId: string) => orderId.slice(-6).toUpperCase();
/** Fecha corta en hora de Colombia: "20 nov. 2026". */
const shortDate = (d: Date) =>
  d.toLocaleDateString('es-CO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'America/Bogota',
  });

/** Nombre apto para la cabecera From (sin comillas, <> ni saltos de línea). */
function displayName(name: string): string {
  return name.replace(/["<>\r\n\\]/g, '').trim() || PLATFORM_NAME;
}

const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i;
const BRAND_TTL_MS = 5 * 60_000;

/**
 * Único punto de envío de correos transaccionales (Resend). Si no hay
 * RESEND_API_KEY configurada, loguea el contenido relevante en vez de fallar,
 * para que dev/staging funcionen sin proveedor de email.
 *
 * Los correos de una tienda salen con su nombre como remitente
 * ("ORÍGEN <hola@bestkofi.com>"), su logo y color, y responden a su correo de
 * contacto. Los de la plataforma (bienvenida, comisión) salen como Bestkofi.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly brandCache = new Map<
    string,
    { brand: MailBrand; exp: number }
  >();

  constructor(
    private readonly config: ConfigService,
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  /** Marca de la plataforma. */
  platformBrand(): MailBrand {
    return {
      name: PLATFORM_NAME,
      url: platformUrl(this.config),
      replyTo: this.config.get<string>('platformContactEmail') || null,
    };
  }

  /** Marca de una tienda (nombre, web, logo, color, contacto). */
  async brandFor(tenantId: string | null | undefined): Promise<MailBrand> {
    if (!tenantId || !this.prisma) return this.platformBrand();
    const hit = this.brandCache.get(tenantId);
    if (hit && hit.exp > Date.now()) return hit.brand;

    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true, slug: true, branding: true },
    });
    if (!t) return this.platformBrand();
    const b = (t.branding ?? {}) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === 'string' ? v.trim() : null);
    const brand: MailBrand = {
      name: t.name,
      url: storeUrl(t.slug, this.config),
      logoUrl: str(b.logoUrl),
      primary: str(b.primary),
      accent: str(b.accent),
      city: str(b.city),
      replyTo: str(b.contactEmail),
    };
    this.brandCache.set(tenantId, { brand, exp: Date.now() + BRAND_TTL_MS });
    return brand;
  }

  private async send(opts: {
    to: string;
    subject: string;
    html: string;
    brand: MailBrand;
    /** Qué loguear si no hay API key (incluye el link accionable). */
    fallbackLog: string;
  }): Promise<void> {
    const apiKey = this.config.get<string>('resend.apiKey');
    if (!apiKey) {
      this.logger.warn(
        `[EMAIL NOT SENT — configure RESEND_API_KEY] ${opts.fallbackLog}`,
      );
      return;
    }

    // Import dinámico: no falla el boot si el paquete/clave no están presentes.
    const { Resend } = await import('resend');
    const resend = new Resend(apiKey);
    // EMAIL_FROM fija la dirección (dominio verificado en Resend); el nombre
    // visible es el de la tienda o el de la plataforma.
    const configured =
      this.config.get<string>('resend.from') ?? 'noreply@example.com';
    const address = /<([^>]+)>/.exec(configured)?.[1] ?? configured.trim();
    const from = `"${displayName(opts.brand.name)}" <${address}>`;
    const replyTo =
      opts.brand.replyTo && EMAIL_RE.test(opts.brand.replyTo)
        ? opts.brand.replyTo
        : undefined;

    const { data, error } = await resend.emails.send({
      from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      ...(replyTo && { replyTo }),
    });

    if (error) {
      this.logger.error(
        `[Resend Error] No se pudo enviar correo a "${opts.to}": ${error.message}`,
      );
      this.logger.warn(`[Fallback Link] ${opts.fallbackLog}`);
    } else {
      this.logger.log(
        `[Resend OK] Correo "${opts.subject}" enviado a ${opts.to} (id: ${data?.id})`,
      );
    }
  }

  /**
   * Magic link de acceso para operadores. Con `tenantId` sale con la marca de
   * esa tienda; sin él (dueño de la plataforma), con la de la plataforma.
   */
  async sendOperatorMagicLink(
    to: string,
    name: string | null,
    link: string,
    tenantId?: string | null,
  ): Promise<void> {
    const brand = await this.brandFor(tenantId);
    await this.send({
      to,
      brand,
      subject: `Tu acceso al panel de ${brand.name}`,
      fallbackLog: `Magic link for ${to}: ${link}`,
      html: renderEmail({
        brand,
        preheader: 'Entra con un clic. El enlace vence en 15 minutos.',
        kicker: 'Acceso al panel',
        heading: name ? `Hola, ${name}` : 'Hola',
        body: p(
          `Aquí tienes tu enlace para entrar al panel de ${strong(brand.name)}. Sin contraseñas: un clic y estás dentro.`,
        ),
        cta: { label: 'Entrar al panel', href: safeHref(link) ?? '#' },
        signoff: false,
        note: 'El enlace vence en 15 minutos y sirve una sola vez. Si no lo pediste, ignora este correo.',
      }),
    });
  }

  /** Verificación de correo para clientes del storefront. */
  async sendCustomerVerification(
    to: string,
    name: string | null | undefined,
    link: string,
    tenantId?: string | null,
  ): Promise<void> {
    const brand = await this.brandFor(tenantId);
    await this.send({
      to,
      brand,
      subject: `Confirma tu correo en ${brand.name}`,
      fallbackLog: `Verify link for ${to}: ${link}`,
      html: renderEmail({
        brand,
        preheader: 'Un clic para activar tu cuenta.',
        kicker: 'Bienvenida',
        heading: name ? `Hola, ${name}` : 'Te damos la bienvenida',
        body: p(
          `Gracias por crear tu cuenta en ${strong(brand.name)}. Confirma tu correo y listo: podrás seguir tus pedidos y manejar tus suscripciones.`,
        ),
        cta: { label: 'Confirmar mi correo', href: safeHref(link) ?? '#' },
        note: 'El enlace vence en 24 horas. Si no creaste esta cuenta, ignora este mensaje.',
      }),
    });
  }

  /** Recuperación de contraseña para clientes del storefront. */
  async sendCustomerPasswordReset(
    to: string,
    name: string | null | undefined,
    link: string,
    tenantId?: string | null,
  ): Promise<void> {
    const brand = await this.brandFor(tenantId);
    await this.send({
      to,
      brand,
      subject: `Restablece tu contraseña de ${brand.name}`,
      fallbackLog: `Password reset link for ${to}: ${link}`,
      html: renderEmail({
        brand,
        preheader: 'Elige una contraseña nueva. El enlace vence en 1 hora.',
        kicker: 'Tu cuenta',
        heading: 'Elige una contraseña nueva',
        body: p(
          `${greeting(name)}, recibimos una solicitud para cambiar la contraseña de tu cuenta en ${strong(brand.name)}.`,
        ),
        cta: { label: 'Cambiar contraseña', href: safeHref(link) ?? '#' },
        note: 'El enlace vence en 1 hora y sirve una sola vez. Si no pediste el cambio, tu contraseña sigue igual.',
      }),
    });
  }

  /**
   * Propuesta de cambio de comisión: el dueño del tenant debe aceptarla en su
   * panel antes de que entre en vigor. Correo de la plataforma.
   */
  async sendCommissionChangeProposal(
    to: string,
    storeName: string,
    oldPct: number,
    newPct: number,
    panelUrl: string,
  ): Promise<void> {
    const brand = this.platformBrand();
    await this.send({
      to,
      brand,
      subject: `Propuesta de cambio de comisión para ${storeName}`,
      fallbackLog: `Commission proposal ${to} (${storeName}): ${oldPct}% → ${newPct}%. Panel: ${panelUrl}`,
      html: renderEmail({
        brand,
        preheader: `${oldPct}% → ${newPct}%. No aplica hasta que lo apruebes.`,
        kicker: storeName,
        heading: 'Propuesta de nueva comisión',
        facts: [
          { label: 'Actual', value: `${oldPct}%` },
          { label: 'Propuesta', value: `${newPct}%` },
        ],
        body: p(
          'El cambio <strong>no aplica</strong> hasta que lo apruebes desde tu panel, donde puedes aceptarlo o rechazarlo.',
        ),
        cta: { label: 'Revisar propuesta', href: safeHref(panelUrl) ?? '#' },
        note: 'Si no reconoces esta solicitud, ignórala: tu comisión actual sigue vigente.',
      }),
    });
  }

  /** Confirmación de orden de compra pagada. */
  async sendOrderConfirmation(opts: {
    to: string;
    customerName: string | null;
    orderId: string;
    tenantId: string;
    totalCents: number;
    items: Array<{
      productName: string;
      variantName: string;
      quantity: number;
      lineCents: number;
    }>;
  }): Promise<void> {
    const brand = await this.brandFor(opts.tenantId);
    const id = shortId(opts.orderId);

    await this.send({
      to: opts.to,
      brand,
      subject: `Recibimos tu pedido #${id}`,
      fallbackLog: `Order confirmation for ${opts.to} (Order: ${opts.orderId}, Store: ${brand.name}, Total: ${money(opts.totalCents)})`,
      html: renderEmail({
        brand,
        preheader: `Pedido #${id} confirmado por ${money(opts.totalCents)}.`,
        kicker: 'Pedido confirmado',
        heading: opts.customerName
          ? `Gracias, ${opts.customerName}`
          : 'Gracias por tu compra',
        facts: [
          { label: 'Pedido', value: `#${id}` },
          { label: 'Fecha', value: shortDate(new Date()) },
          { label: 'Total', value: money(opts.totalCents) },
        ],
        body:
          p(
            'Ya tenemos tu pedido. Lo preparamos con café recién tostado y te avisamos apenas salga.',
          ) +
          receipt(
            opts.items.map((it) => ({
              name: it.productName,
              detail: `${it.variantName} · ${it.quantity} ud.`,
              amount: money(it.lineCents),
            })),
            { label: 'Total pagado', amount: money(opts.totalCents) },
          ),
        note: 'Cuando despachemos, te llega otro correo con el número de guía.',
      }),
    });
  }

  /** Notificación de pedido despachado (SHIPPED) con enlace de rastreo opcional. */
  async sendOrderShipped(opts: {
    to: string;
    customerName: string | null;
    orderId: string;
    tenantId: string;
    trackingUrl?: string | null;
  }): Promise<void> {
    const brand = await this.brandFor(opts.tenantId);
    const id = shortId(opts.orderId);
    // La URL de rastreo la escribe el personal de la tienda: solo http(s).
    const trackingHref = safeHref(opts.trackingUrl);

    await this.send({
      to: opts.to,
      brand,
      subject: `Tu pedido #${id} va en camino`,
      fallbackLog: `Order shipped for ${opts.to} (Order: ${opts.orderId}, Tracking: ${opts.trackingUrl ?? 'N/A'})`,
      html: renderEmail({
        brand,
        preheader: trackingHref
          ? 'Ya puedes seguir tu envío.'
          : 'Pronto llegará a la dirección que indicaste.',
        kicker: 'En camino',
        heading: 'Tu café ya salió',
        facts: [
          { label: 'Pedido', value: `#${id}` },
          { label: 'Despachado', value: shortDate(new Date()) },
        ],
        body: p(
          `${greeting(opts.customerName)}, tu pedido salió de nuestro tostadero. ${trackingHref ? 'Con el botón puedes ver por dónde va.' : 'Pronto llegará a la dirección que indicaste.'}`,
        ),
        cta: trackingHref
          ? { label: 'Rastrear envío', href: trackingHref }
          : null,
      }),
    });
  }

  /**
   * Renovación de suscripción sin cobro en línea: se creó el pedido del nuevo
   * envío y queda pendiente de pago, igual que el primer pedido.
   */
  async sendSubscriptionRenewalPending(opts: {
    to: string;
    customerName: string | null;
    orderId: string;
    tenantId: string;
    productName: string;
    totalCents: number;
  }): Promise<void> {
    const brand = await this.brandFor(opts.tenantId);
    const id = shortId(opts.orderId);

    await this.send({
      to: opts.to,
      brand,
      subject: `Tu próximo envío: pedido #${id} pendiente de pago`,
      fallbackLog: `Subscription renewal pending for ${opts.to} (Order: ${opts.orderId})`,
      html: renderEmail({
        brand,
        preheader: `Pedido #${id} por ${money(opts.totalCents)}.`,
        kicker: 'Tu suscripción',
        heading: 'Tu próximo café está listo',
        facts: [
          { label: 'Pedido', value: `#${id}` },
          { label: 'Café', value: opts.productName },
          { label: 'Total', value: money(opts.totalCents) },
        ],
        body: p(
          `${greeting(opts.customerName)}, generamos el pedido de tu próximo envío. Se paga igual que el primero y lo despachamos en cuanto se confirme.`,
        ),
        note: 'Puedes pausar, saltar o cancelar tu suscripción desde tu cuenta.',
      }),
    });
  }

  /**
   * Aviso al cliente de un cambio que la tienda hizo en su suscripción desde
   * el panel (pausa, reanudación, envío saltado, cancelación o frecuencia).
   */
  async sendSubscriptionChanged(opts: {
    to: string;
    customerName: string | null;
    tenantId: string;
    productName: string;
    change: SubscriptionChange;
    frequencyDays: number;
    nextShipAt: Date | null;
  }): Promise<void> {
    const brand = await this.brandFor(opts.tenantId);
    const hello = greeting(opts.customerName);
    const product = strong(opts.productName);
    const next = opts.nextShipAt
      ? opts.nextShipAt.toLocaleDateString('es-CO', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
          timeZone: 'America/Bogota',
        })
      : null;
    const nextFact = next ? [{ label: 'Próximo envío', value: next }] : [];

    const copy: Record<
      SubscriptionChange,
      {
        subject: string;
        title: string;
        body: string;
        facts: Array<{ label: string; value: string }>;
      }
    > = {
      paused: {
        subject: 'Tu suscripción quedó en pausa',
        title: 'Suscripción en pausa',
        body: p(
          `${hello}, pausamos tu suscripción a ${product}. No habrá envíos mientras siga en pausa.`,
        ),
        facts: [],
      },
      resumed: {
        subject: 'Tu suscripción está activa de nuevo',
        title: 'De vuelta a tu taza',
        body: p(`${hello}, reanudamos tu suscripción a ${product}.`),
        facts: nextFact,
      },
      skipped: {
        subject: 'Saltamos tu próximo envío',
        title: 'Saltamos un envío',
        body: p(
          `${hello}, saltamos el próximo envío de tu suscripción a ${product}.`,
        ),
        facts: nextFact,
      },
      cancelled: {
        subject: 'Tu suscripción fue cancelada',
        title: 'Suscripción cancelada',
        body: p(
          `${hello}, cancelamos tu suscripción a ${product}. No habrá más envíos. Gracias por los cafés compartidos.`,
        ),
        facts: [],
      },
      frequency: {
        subject: 'Cambió la frecuencia de tu suscripción',
        title: 'Nueva frecuencia',
        body: p(
          `${hello}, ajustamos la frecuencia de tu suscripción a ${product}.`,
        ),
        facts: [
          { label: 'Cada', value: `${opts.frequencyDays} días` },
          ...nextFact,
        ],
      },
    };
    const c = copy[opts.change];

    await this.send({
      to: opts.to,
      brand,
      subject: c.subject,
      fallbackLog: `Subscription ${opts.change} (${brand.name})`,
      html: renderEmail({
        brand,
        preheader: c.title,
        kicker: 'Tu suscripción',
        heading: c.title,
        facts: c.facts,
        body: c.body,
      }),
    });
  }

  /** Notificación de pedido cancelado (CANCELLED). */
  async sendOrderCancelled(opts: {
    to: string;
    customerName: string | null;
    orderId: string;
    tenantId: string;
  }): Promise<void> {
    const brand = await this.brandFor(opts.tenantId);
    const id = shortId(opts.orderId);

    await this.send({
      to: opts.to,
      brand,
      subject: `Tu pedido #${id} fue cancelado`,
      fallbackLog: `Order cancelled for ${opts.to} (Order: ${opts.orderId})`,
      html: renderEmail({
        brand,
        preheader: `Cancelamos el pedido #${id}.`,
        kicker: 'Pedido cancelado',
        heading: 'Cancelamos tu pedido',
        facts: [{ label: 'Pedido', value: `#${id}` }],
        body: p(
          `${greeting(opts.customerName)}, tu pedido quedó cancelado. Si ya lo habías pagado, el reembolso llega según los tiempos de tu banco o medio de pago.`,
        ),
      }),
    });
  }

  /** Invitación a un miembro nuevo del equipo de una tienda. */
  async sendMemberInvitation(opts: {
    to: string;
    name: string | null | undefined;
    tenantId: string;
    roleLabel: string;
    accessUrl: string;
  }): Promise<void> {
    const brand = await this.brandFor(opts.tenantId);
    await this.send({
      to: opts.to,
      brand,
      subject: `Te agregaron al equipo de ${brand.name}`,
      fallbackLog: `Member invitation ${opts.to} (store: ${brand.name}, role: ${opts.roleLabel}). Access: ${opts.accessUrl}`,
      html: renderEmail({
        brand,
        preheader: `Tu rol: ${opts.roleLabel}.`,
        kicker: 'Equipo',
        heading: opts.name
          ? `Bienvenido, ${opts.name}`
          : 'Bienvenido al equipo',
        facts: [{ label: 'Tu rol', value: opts.roleLabel }],
        body: p(
          `Ahora eres parte del equipo de ${strong(brand.name)}. Para entrar te pedimos tu correo y te enviamos un enlace de acceso, sin contraseña.`,
        ),
        cta: {
          label: 'Entrar al panel',
          href: safeHref(opts.accessUrl) ?? '#',
        },
        note: 'Si no esperabas esta invitación, ignora este mensaje.',
      }),
    });
  }

  /** Bienvenida al dueño de una tienda recién creada por el superadmin. */
  async sendTenantWelcome(
    to: string,
    ownerName: string | null | undefined,
    storeName: string,
    accessUrl: string,
  ): Promise<void> {
    const brand = this.platformBrand();
    await this.send({
      to,
      brand,
      subject: `${storeName} ya está en línea`,
      fallbackLog: `Welcome ${to} (store: ${storeName}). Access: ${accessUrl}`,
      html: renderEmail({
        brand,
        preheader: 'Entra a tu panel para cargar tus cafés.',
        kicker: 'Tu tienda',
        heading: `${storeName} ya está en línea`,
        body:
          p(
            `${greeting(ownerName)}, tu tienda está creada. Desde el panel cargas tus cafés, escribes tus guías y conectas pagos y envíos.`,
          ) +
          p(
            'Para entrar te pedimos tu correo y te enviamos un enlace de acceso, sin contraseña.',
          ),
        cta: { label: 'Ir a mi panel', href: safeHref(accessUrl) ?? '#' },
      }),
    });
  }
}
