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
    const from = this.config.get<string>('resend.from') ?? 'noreply@example.com';

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
