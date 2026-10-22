import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Único punto de envío de correos transaccionales (Resend). Si no hay
 * RESEND_API_KEY configurada, loguea el contenido relevante en vez de fallar,
 * para que dev/staging funcionen sin proveedor de email.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly config: ConfigService) {}

  private async send(opts: {
    to: string;
    subject: string;
    html: string;
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
    const from =
      this.config.get<string>('resend.from') ?? 'noreply@example.com';

    await resend.emails.send({
      from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
    });
  }

  /** Magic link de acceso para operadores (panel admin / superadmin). */
  async sendOperatorMagicLink(
    to: string,
    name: string | null,
    link: string,
  ): Promise<void> {
    const greeting = name ? `Hola ${name}` : 'Hola';
    await this.send({
      to,
      subject: 'Tu enlace de acceso',
      fallbackLog: `Magic link for ${to}: ${link}`,
      html: `
        <p>${greeting},</p>
        <p>Haz clic en el siguiente enlace para acceder a tu panel.
           El enlace vence en 15 minutos y solo puede usarse una vez.</p>
        <p><a href="${link}">Acceder al panel</a></p>
        <p>Si no solicitaste este acceso, ignora este mensaje.</p>
      `,
    });
  }

  /** Verificación de correo para clientes del storefront. */
  async sendCustomerVerification(
    to: string,
    name: string | null | undefined,
    link: string,
  ): Promise<void> {
    const greeting = name ? `Hola ${name}` : 'Hola';
    await this.send({
      to,
      subject: 'Activa tu cuenta',
      fallbackLog: `Verify link for ${to}: ${link}`,
      html: `
        <p>${greeting},</p>
        <p>Haz clic en el siguiente enlace para verificar tu correo.
           El enlace vence en 24 horas.</p>
        <p><a href="${link}">Verificar mi correo</a></p>
        <p>Si no creaste esta cuenta, ignora este mensaje.</p>
      `,
    });
  }

  /**
   * Propuesta de cambio de comisión: el dueño del tenant debe aceptarla en su
   * panel antes de que entre en vigor.
   */
  async sendCommissionChangeProposal(
    to: string,
    storeName: string,
    oldPct: number,
    newPct: number,
    panelUrl: string,
  ): Promise<void> {
    await this.send({
      to,
      subject: `Cambio en tu comisión — ${storeName}`,
      fallbackLog: `Commission proposal ${to} (${storeName}): ${oldPct}% → ${newPct}%. Panel: ${panelUrl}`,
      html: `
        <p>Hola,</p>
        <p>Proponemos ajustar la comisión por ventas de tu tienda
           <strong>${storeName}</strong>:</p>
        <p style="font-size:18px"><strong>${oldPct}% → ${newPct}%</strong></p>
        <p>Este cambio <strong>no aplica</strong> hasta que lo apruebes. Entra a tu
           panel para revisarlo y aceptarlo o rechazarlo.</p>
        <p><a href="${panelUrl}">Revisar en mi panel</a></p>
        <p>Si no reconoces esta solicitud, ignórala: tu comisión actual seguirá vigente.</p>
      `,
    });
  }

  /** Confirmación de orden de compra pagada. */
  async sendOrderConfirmation(opts: {
    to: string;
    customerName: string | null;
    orderId: string;
    storeName: string;
    totalCents: number;
    items: Array<{
      productName: string;
      variantName: string;
      quantity: number;
      lineCents: number;
    }>;
  }): Promise<void> {
    const greeting = opts.customerName ? `Hola ${opts.customerName}` : 'Hola';
    const itemsHtml = opts.items
      .map(
        (it) => `
        <tr>
          <td style="padding:8px; border-bottom:1px solid #eee;">
            <strong>${it.productName}</strong><br/>
            <small style="color:#666;">${it.variantName}</small>
          </td>
          <td style="padding:8px; border-bottom:1px solid #eee; text-align:center;">${it.quantity}</td>
          <td style="padding:8px; border-bottom:1px solid #eee; text-align:right;">$${(it.lineCents / 100).toLocaleString('es-CO')}</td>
        </tr>`,
      )
      .join('');

    const formattedTotal = `$${(opts.totalCents / 100).toLocaleString('es-CO')}`;

    await this.send({
      to: opts.to,
      subject: `¡Confirmación de compra en ${opts.storeName}! (Orden #${opts.orderId.slice(-6).toUpperCase()})`,
      fallbackLog: `Order confirmation for ${opts.to} (Order: ${opts.orderId}, Store: ${opts.storeName}, Total: ${formattedTotal})`,
      html: `
        <div style="font-family:sans-serif; max-width:600px; margin:0 auto; color:#333;">
          <h2>¡Gracias por tu compra!</h2>
          <p>${greeting}, hemos recibido tu pedido en <strong>${opts.storeName}</strong> y ya lo estamos preparando.</p>
          <p><strong>Número de pedido:</strong> #${opts.orderId.slice(-6).toUpperCase()}</p>
          
          <table style="width:100%; border-collapse:collapse; margin-top:20px; font-size:14px;">
            <thead>
              <tr style="background:#f9f9f9; text-align:left;">
                <th style="padding:8px; border-bottom:2px solid #ddd;">Producto</th>
                <th style="padding:8px; border-bottom:2px solid #ddd; text-align:center;">Cant.</th>
                <th style="padding:8px; border-bottom:2px solid #ddd; text-align:right;">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHtml}
            </tbody>
            <tfoot>
              <tr>
                <td colspan="2" style="padding:12px 8px; font-weight:bold; text-align:right;">Total pagado:</td>
                <td style="padding:12px 8px; font-weight:bold; text-align:right;">${formattedTotal}</td>
              </tr>
            </tfoot>
          </table>

          <p style="margin-top:24px; font-size:13px; color:#777;">
            Te notificaremos en cuanto tu paquete sea despachado con la información de rastreo.
          </p>
        </div>
      `,
    });
  }

  /** Bienvenida al dueño de una tienda recién creada por el superadmin. */
  async sendTenantWelcome(
    to: string,
    ownerName: string | null | undefined,
    storeName: string,
    accessUrl: string,
  ): Promise<void> {
    const greeting = ownerName ? `Hola ${ownerName}` : 'Hola';
    await this.send({
      to,
      subject: `Tu tienda ${storeName} está lista`,
      fallbackLog: `Welcome ${to} (store: ${storeName}). Access: ${accessUrl}`,
      html: `
        <p>${greeting},</p>
        <p>Creamos tu tienda <strong>${storeName}</strong> en BestCoffee.
           Ya puedes acceder a tu panel para configurar productos, contenido y más.</p>
        <p><a href="${accessUrl}">Acceder a mi panel</a></p>
        <p>Te pediremos tu correo para enviarte un enlace de acceso seguro
           (sin contraseña).</p>
        <p>¡Bienvenido a bordo!</p>
      `,
    });
  }
}
