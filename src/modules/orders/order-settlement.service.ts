import { Injectable, Logger } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { inngest } from '../inngest/inngest.client';

export type PaymentSettlementEvent =
  | {
      provider: 'STRIPE';
      eventId: string;
      eventType: string;
      stripePaymentIntentId: string;
    }
  | {
      provider: 'MERCADOPAGO';
      eventId: string;
      eventType: string;
      mpPaymentId: string;
    };

/**
 * Módulo profundo (Deep Module) responsable de la liquidación transaccional de
 * órdenes pagadas y la reversión de inventario/cupones al cancelar.
 *
 * Oculta detrás de dos métodos simples:
 *  1. El doble blindaje de idempotencia (tabla de eventos de pasarela + estado PAID).
 *  2. El descuento/restitución atómica de stock por variante.
 *  3. El conteo/reversión de redenciones de cupones (`DiscountCode.timesRedeemed`).
 *  4. El disparo del evento `order/created` hacia Inngest únicamente cuando la
 *     transición a PAID ocurre por primera vez.
 */
@Injectable()
export class OrderSettlementService {
  private readonly logger = new Logger(OrderSettlementService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Marca una orden como PAID de forma idempotente, descuenta inventario,
   * contabiliza el cupón y dispara el job de confirmación en Inngest.
   */
  async settlePaidOrder(
    orderId: string,
    settlement: PaymentSettlementEvent,
  ): Promise<{ settled: boolean }> {
    const settled = await this.prisma.$transaction(async (tx) => {
      // Guarda #1 de idempotencia: registro único del evento de pasarela.
      try {
        if (settlement.provider === 'STRIPE') {
          await tx.stripeEvent.create({
            data: { id: settlement.eventId, type: settlement.eventType },
          });
        } else {
          await tx.mercadoPagoEvent.create({
            data: { id: settlement.eventId, type: settlement.eventType },
          });
        }
      } catch {
        return false;
      }

      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: true },
      });
      if (!order) return false;

      // Guarda #2 de idempotencia: si la orden ya estaba PAID (ej. pago síncrono
      // + webhook posterior con otro eventId), no descontar stock ni redimir dos veces.
      if (order.paymentStatus === 'PAID') {
        return false;
      }

      await tx.order.update({
        where: { id: orderId },
        data: {
          paymentStatus: 'PAID',
          ...(settlement.provider === 'STRIPE'
            ? { stripePaymentIntentId: settlement.stripePaymentIntentId }
            : { mpPaymentId: settlement.mpPaymentId }),
        },
      });

      // Decrementar stock sin bajar de 0.
      for (const item of order.items) {
        await tx.productVariant.updateMany({
          where: { id: item.variantId, stock: { gt: 0 } },
          data: { stock: { decrement: item.quantity } },
        });
      }

      // Contabilizar uso del código de descuento si aplica.
      if (order.discountCode) {
        await tx.discountCode.updateMany({
          where: { tenantId: order.tenantId, code: order.discountCode },
          data: { timesRedeemed: { increment: 1 } },
        });
      }

      return true;
    });

    if (settled) {
      // Fuera de la transacción para no bloquear commit ante errores de red.
      try {
        await inngest.send({ name: 'order/created', data: { orderId } });
      } catch (err) {
        this.logger.error('inngest.send order/created falló', err);
      }
    }

    return { settled };
  }

  /**
   * Cancela una orden y, si ya estaba pagada (`PAID`), restituye atómicamente
   * el stock reservado de cada variante y la redención del cupón de descuento.
   */
  async cancelOrderAndRestoreInventory<TInclude extends Prisma.OrderInclude>(
    orderId: string,
    opts: {
      trackingUrl?: string;
      include: TInclude;
    },
  ): Promise<Prisma.OrderGetPayload<{ include: TInclude }>> {
    return this.prisma.$transaction(async (tx) => {
      const fullOrder = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: true },
      });

      if (fullOrder && fullOrder.paymentStatus === 'PAID') {
        for (const item of fullOrder.items) {
          await tx.productVariant.update({
            where: { id: item.variantId },
            data: { stock: { increment: item.quantity } },
          });
        }

        if (fullOrder.discountCode) {
          await tx.discountCode.updateMany({
            where: {
              tenantId: fullOrder.tenantId,
              code: fullOrder.discountCode,
              timesRedeemed: { gt: 0 },
            },
            data: { timesRedeemed: { decrement: 1 } },
          });
        }
      }

      return tx.order.update({
        where: { id: orderId },
        data: {
          status: OrderStatus.CANCELLED,
          ...(opts.trackingUrl !== undefined && {
            trackingUrl: opts.trackingUrl,
          }),
        },
        include: opts.include,
      });
    });
  }
}
