import { Injectable, Logger } from '@nestjs/common';
import { GrindFormat, OrderSource, SubStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StripeService } from '../stripe/stripe.service';

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class SubscriptionRenewalService {
  private readonly logger = new Logger(SubscriptionRenewalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
  ) {}

  /**
   * Procesa todas las suscripciones activas cuya fecha de próximo envío ya haya llegado.
   * Por cada una crea la orden recurrente, ejecuta el cargo en Stripe y actualiza el próximo envío.
   */
  async processDueSubscriptions(): Promise<{
    processed: number;
    errors: number;
  }> {
    const now = new Date();

    const dueSubscriptions = await this.prisma.subscription.findMany({
      where: {
        status: SubStatus.ACTIVE,
        nextShipAt: { lte: now },
      },
      include: {
        customer: { select: { id: true, stripeCustomerId: true } },
        variant: {
          select: {
            id: true,
            sizeGrams: true,
            grind: true,
            priceSubscription: true,
            priceOneTime: true,
            product: { select: { name: true } },
          },
        },
      },
      take: 50,
    });

    let processed = 0;
    let errors = 0;

    for (const sub of dueSubscriptions) {
      try {
        await this.renewSubscription(sub);
        processed++;
      } catch (err: unknown) {
        errors++;
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `Error procesando renovación de suscripción ${sub.id}: ${message}`,
        );

        // Marca la suscripción en fallo de pago si el cobro fue rechazado
        await this.prisma.subscription
          .update({
            where: { id: sub.id },
            data: { status: SubStatus.PAYMENT_FAILED },
          })
          .catch(() => undefined);
      }
    }

    return { processed, errors };
  }

  private async renewSubscription(sub: {
    id: string;
    tenantId: string;
    customerId: string;
    frequencyDays: number;
    discountPct: number;
    shippingAddress: unknown;
    customer: { id: string; stripeCustomerId: string | null };
    variant: {
      id: string;
      sizeGrams: number;
      grind: GrindFormat;
      priceSubscription: number | null;
      priceOneTime: number;
      product: { name: string };
    };
  }) {
    if (!sub.customer.stripeCustomerId) {
      throw new Error(
        'El cliente no tiene un método de pago registrado en Stripe',
      );
    }

    const unitCents = sub.variant.priceSubscription ?? sub.variant.priceOneTime;
    const discountCents =
      sub.discountPct > 0 ? Math.round((unitCents * sub.discountPct) / 100) : 0;
    const totalCents = Math.max(0, unitCents - discountCents);

    // 1. Crear la orden de suscripción en estado PENDING
    const order = await this.prisma.order.create({
      data: {
        tenantId: sub.tenantId,
        customerId: sub.customerId,
        source: OrderSource.SUBSCRIPTION_RENEWAL,
        status: 'RECEIVED',
        paymentStatus: 'PENDING',
        subscriptionId: sub.id,
        shippingAddress: sub.shippingAddress ?? {},
        subtotalCents: unitCents,
        discountCents,
        shippingCents: 0,
        totalCents,
        items: {
          create: [
            {
              tenantId: sub.tenantId,
              variantId: sub.variant.id,
              productName: sub.variant.product.name,
              variantName: `${sub.variant.sizeGrams}g · ${sub.variant.grind}`,
              grind: sub.variant.grind,
              sizeGrams: sub.variant.sizeGrams,
              unitCents,
              quantity: 1,
              lineCents: unitCents,
            },
          ],
        },
      },
    });

    // 2. Realizar el cobro off-session en Stripe
    const { piId } = await this.stripe.chargeOffSession(
      sub.customer.stripeCustomerId,
      totalCents,
      order.id,
      sub.tenantId,
    );

    // 3. Actualizar la orden y avanzar la fecha de la suscripción
    const nextShipAt = new Date(Date.now() + sub.frequencyDays * DAY_MS);

    await this.prisma.$transaction([
      this.prisma.order.update({
        where: { id: order.id },
        data: { stripePaymentIntentId: piId },
      }),
      this.prisma.subscription.update({
        where: { id: sub.id },
        data: {
          lastShippedAt: new Date(),
          nextShipAt,
        },
      }),
    ]);
  }
}
