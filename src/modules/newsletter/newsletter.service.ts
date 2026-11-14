import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SubscribeNewsletterDto } from './dto/subscribe-newsletter.dto';
import {
  readNewsletterConfig,
  resolveWelcomeOffer,
  type WelcomeOffer,
} from './newsletter-config';

export interface SubscribeResult {
  message: string;
  /** Cupón de bienvenida del tenant, solo si existe y está vigente. */
  welcomeOffer: WelcomeOffer | null;
}

@Injectable()
export class NewsletterService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Suscribe a un visitante sin sesión. Reglas de privacidad:
   *  - La respuesta es idéntica exista o no el correo (no se enumera nada).
   *  - Un endpoint público NUNCA reactiva a quien ya se dio de baja (ni a un
   *    cliente con cuenta que desactivó el boletín): solo esa persona puede
   *    volver a activarlo (desde "Mis datos" o un enlace propio).
   *  - Los clientes con cuenta ya están suscritos por defecto; no se duplican.
   */
  async subscribe(
    tenantId: string,
    dto: SubscribeNewsletterDto,
  ): Promise<SubscribeResult> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { features: true },
    });
    const cfg = readNewsletterConfig(tenant?.features);
    const welcomeOffer = await resolveWelcomeOffer(
      this.prisma,
      tenantId,
      cfg.welcomeCode,
    );

    const customer = await this.prisma.customer.findUnique({
      where: { tenantId_email: { tenantId, email: dto.email } },
      select: { id: true },
    });

    if (!customer) {
      await this.prisma.newsletterSubscriber.upsert({
        where: { tenantId_email: { tenantId, email: dto.email } },
        // update vacío a propósito: no reactivar bajas ni pisar el origen.
        update: {},
        create: {
          tenantId,
          email: dto.email,
          source: dto.source ?? 'popup',
        },
      });
    }

    return {
      message: '¡Listo! Ya haces parte de nuestra comunidad.',
      welcomeOffer,
    };
  }
}
