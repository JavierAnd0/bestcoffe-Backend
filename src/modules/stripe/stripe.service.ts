import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { SubStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { inngest } from '../inngest/inngest.client';

// Stripe v22 usa `export = StripeConstructor` cuyo namespace sólo expone
// `StripeConstructor.Stripe`. InstanceType<> extrae el tipo de instancia sin
// tocar el namespace, que causaría TS2709 con emitDecoratorMetadata.
type StripeSDK = InstanceType<typeof Stripe>;

// Tipos mínimos de lo que usamos del evento de webhook.
type WebhookEvent = {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
};
type PaymentIntentLike = {
  id: string;
  client_secret: string | null;
  metadata: Record<string, string>;
};
type SetupIntentLike = {
  metadata: Record<string, string>;
  payment_method: string | null;
};

@Injectable()
export class StripeService {
  private _sdk: StripeSDK | null = null;
  private readonly webhookSecret: string;
  private readonly logger = new Logger(StripeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.webhookSecret = this.config.get<string>('stripe.webhookSecret') ?? '';
  }

  /**
   * Cliente Stripe perezoso. No instanciamos en el constructor porque Stripe v22
   * lanza si la API key está vacía; eso tumbaría toda la app cuando una tienda
   * usa solo MercadoPago. Se crea al primer uso y solo falla quien intente cobrar
   * con Stripe sin configurarlo.
   */
  private get sdk(): StripeSDK {
    if (!this._sdk) {
      const key = this.config.get<string>('stripe.secretKey');
      if (!key) {
        throw new BadRequestException(
          'Stripe no está configurado para esta plataforma',
        );
      }
      this._sdk = new Stripe(key);
    }
    return this._sdk;
  }

  /**
   * Crea un PaymentIntent para cobrar una orden.
   * COP es zero-decimal en Stripe → amount = centavos_db / 100.
   */
  async createPaymentIntent(
    amountCents: number,
    orderId: string,
    tenantId: string,
  ): Promise<{ clientSecret: string; piId: string }> {
    const pi = await this.sdk.paymentIntents.create({
      amount: Math.round(amountCents / 100),
      currency: 'cop',
      metadata: { orderId, tenantId },
    });
    return { clientSecret: pi.client_secret!, piId: pi.id };
  }

  /**
   * Procesa un evento de webhook Stripe.
   * rawBody DEBE ser el Buffer sin parsear (main.ts tiene rawBody:true).
   */
  async handleWebhook(rawBody: Buffer, signature: string): Promise<void> {
    if (!this.webhookSecret) {
      this.logger.warn('STRIPE_WEBHOOK_SECRET no configurado — webhook ignorado');
      return;
    }

    let event: WebhookEvent;
    try {
      event = this.sdk.webhooks.constructEvent(
        rawBody,
        signature,
        this.webhookSecret,
      ) as unknown as WebhookEvent;
    } catch {
      throw new BadRequestException('Webhook signature inválida');
    }

    switch (event.type) {
      case 'payment_intent.succeeded':
        await this.onPaymentSucceeded(event);
        break;
      case 'payment_intent.payment_failed':
        await this.onPaymentFailed(event);
        break;
      case 'setup_intent.succeeded':
        await this.onSetupIntentSucceeded(event);
        break;
    }
  }

  /**
   * Devuelve el Stripe Customer ID del cliente, creándolo en Stripe si no
   * existe todavía y guardando el nuevo ID en la base de datos.
   */
  async createOrGetStripeCustomer(customer: {
    id: string;
    email: string;
    name: string | null;
    stripeCustomerId: string | null;
    tenantId: string;
  }): Promise<string> {
    if (customer.stripeCustomerId) return customer.stripeCustomerId;
    const sc = await this.sdk.customers.create({
      email: customer.email,
      name: customer.name ?? undefined,
      metadata: { customerId: customer.id, tenantId: customer.tenantId },
    });
    await this.prisma.customer.update({
      where: { id: customer.id },
      data: { stripeCustomerId: sc.id },
    });
    return sc.id;
  }

  /**
   * Crea un SetupIntent para guardar el método de pago del cliente
   * (off_session, para cargos futuros de suscripción).
   */
  async createSetupIntent(
    stripeCustomerId: string,
    metadata: Record<string, string>,
  ): Promise<string> {
    const si = await this.sdk.setupIntents.create({
      customer: stripeCustomerId,
      usage: 'off_session',
      metadata,
    });
    return si.client_secret!;
  }

  // ─── Handlers privados ───────────────────────────────────────────────────

  private async onPaymentSucceeded(event: WebhookEvent): Promise<void> {
    const pi = event.data.object as PaymentIntentLike;
    const orderId = pi.metadata['orderId'];
    if (!orderId) return;

    await this.prisma.$transaction(async (tx) => {
      // Idempotencia: si el evento ya fue procesado, salir sin hacer nada.
      try {
        await tx.stripeEvent.create({ data: { id: event.id, type: event.type } });
      } catch {
        return;
      }

      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: true },
      });
      if (!order) return;

      await tx.order.update({
        where: { id: orderId },
        data: { paymentStatus: 'PAID', stripePaymentIntentId: pi.id },
      });

      // Decrementar stock sin ir a negativo.
      for (const item of order.items) {
        await tx.productVariant.updateMany({
          where: { id: item.variantId, stock: { gt: 0 } },
          data: { stock: { decrement: item.quantity } },
        });
      }

      // Contabilizar uso del código de descuento.
      if (order.discountCode) {
        await tx.discountCode.updateMany({
          where: { tenantId: order.tenantId, code: order.discountCode },
          data: { timesRedeemed: { increment: 1 } },
        });
      }
    });

    // Fuera de la transacción: no queremos bloquearla ante errores de red.
    try {
      await inngest.send({ name: 'order/created', data: { orderId } });
    } catch (err) {
      this.logger.error('inngest.send order/created falló', err);
    }
  }

  private async onPaymentFailed(event: WebhookEvent): Promise<void> {
    const pi = event.data.object as PaymentIntentLike;
    const orderId = pi.metadata['orderId'];
    if (!orderId) return;

    await this.prisma.$transaction(async (tx) => {
      try {
        await tx.stripeEvent.create({ data: { id: event.id, type: event.type } });
      } catch {
        return;
      }
      await tx.order.update({
        where: { id: orderId },
        data: { paymentStatus: 'FAILED' },
      });
    });
  }

  private async onSetupIntentSucceeded(event: WebhookEvent): Promise<void> {
    const si = event.data.object as SetupIntentLike;
    const subscriptionId = si.metadata['subscriptionId'];
    if (!subscriptionId) return;

    await this.prisma.$transaction(async (tx) => {
      try {
        await tx.stripeEvent.create({ data: { id: event.id, type: event.type } });
      } catch {
        return; // idempotencia
      }
      await tx.subscription.update({
        where: { id: subscriptionId },
        data: { status: SubStatus.ACTIVE },
      });
    });
  }
}
