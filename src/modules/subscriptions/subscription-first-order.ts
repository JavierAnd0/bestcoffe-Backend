import { OrderSource, Prisma, SubStatus } from '@prisma/client';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Suscripciones con "pedidos sin pagos".
 *
 * Una suscripción nace en el checkout junto a su primer pedido, pero no debe
 * generar envíos recurrentes hasta que ese pedido se pague. Sin migraciones, el
 * estado "esperando el pago del primer pedido" se representa así:
 *
 *   status = PAYMENT_FAILED  y  lastShippedAt = null
 *
 * - Las renovaciones solo procesan ACTIVE / SKIPPED_NEXT, así que no genera
 *   pedidos.
 * - Al liquidarse el primer pedido como pagado (operador o pasarela) pasa a
 *   ACTIVE con `lastShippedAt` = fecha del pago: desde ese momento ya no cumple
 *   este predicado, aunque más adelante falle un cobro.
 * - El cliente no puede reanudarla ni pausarla (ver SubscriptionLifecycleService);
 *   sí cancelarla.
 */
export const AWAITING_FIRST_PAYMENT = {
  status: SubStatus.PAYMENT_FAILED,
  lastShippedAt: null,
} satisfies Prisma.SubscriptionWhereInput;

export function isAwaitingFirstPayment(sub: {
  status: SubStatus;
  lastShippedAt: Date | null;
}): boolean {
  return sub.status === SubStatus.PAYMENT_FAILED && sub.lastShippedAt === null;
}

/** Datos del pedido que necesitan las funciones de abajo. */
export type FirstOrderLike = {
  id: string;
  tenantId: string;
  customerId: string;
  source: OrderSource;
  subscriptionId: string | null;
  items: Array<{ variantId: string }>;
};

/**
 * Un pedido de checkout con `subscriptionId` es un pedido "por suscripción":
 * cada una de sus líneas tiene una suscripción del mismo cliente y variante.
 * (`Order.subscriptionId` solo enlaza la primera; las demás se encuentran por
 * cliente + variante, que es único entre las no canceladas: ver checkout.)
 */
function isSubscriptionCheckout(order: FirstOrderLike): boolean {
  return order.source === OrderSource.CHECKOUT && !!order.subscriptionId;
}

/**
 * Activa (dentro de la transacción de la liquidación) las suscripciones que
 * esperaban el pago de este pedido. Idempotente: las ya activas no cumplen el
 * predicado. Si el cliente ya tiene otra suscripción ACTIVE de la misma
 * variante (p. ej. un regalo canjeado entre medias), no se activa para no
 * violar el índice único parcial y abortar la liquidación.
 */
export async function activateFirstOrderSubscriptions(
  tx: Prisma.TransactionClient,
  order: FirstOrderLike,
  now: Date = new Date(),
): Promise<string[]> {
  if (!isSubscriptionCheckout(order)) return [];

  const pending = await tx.subscription.findMany({
    where: {
      tenantId: order.tenantId,
      customerId: order.customerId,
      variantId: { in: order.items.map((i) => i.variantId) },
      ...AWAITING_FIRST_PAYMENT,
    },
    select: { id: true, variantId: true, frequencyDays: true },
  });

  const activated: string[] = [];
  for (const sub of pending) {
    const clash = await tx.subscription.findFirst({
      where: {
        customerId: order.customerId,
        variantId: sub.variantId,
        status: SubStatus.ACTIVE,
      },
      select: { id: true },
    });
    if (clash) continue;

    await tx.subscription.update({
      where: { id: sub.id },
      data: {
        status: SubStatus.ACTIVE,
        // El pedido pagado es el primer envío; el siguiente, una frecuencia después.
        lastShippedAt: now,
        nextShipAt: new Date(now.getTime() + sub.frequencyDays * DAY_MS),
      },
    });
    activated.push(sub.id);
  }
  return activated;
}

/**
 * Al cancelar un primer pedido sin pagar, cancela las suscripciones que
 * esperaban su pago, salvo que otro pedido abierto del mismo cliente siga
 * esperando el pago de esa misma suscripción (se reutilizan: ver checkout).
 * Si el pedido ya estaba pagado la suscripción está activa y no se toca: el
 * operador decide en Suscripciones.
 */
export async function cancelFirstOrderSubscriptions(
  tx: Prisma.TransactionClient,
  order: FirstOrderLike,
): Promise<string[]> {
  if (!isSubscriptionCheckout(order)) return [];

  const pending = await tx.subscription.findMany({
    where: {
      tenantId: order.tenantId,
      customerId: order.customerId,
      variantId: { in: order.items.map((i) => i.variantId) },
      ...AWAITING_FIRST_PAYMENT,
    },
    select: { id: true, variantId: true },
  });

  const cancelled: string[] = [];
  for (const sub of pending) {
    const otherOpenOrder = await tx.order.findFirst({
      where: {
        id: { not: order.id },
        tenantId: order.tenantId,
        customerId: order.customerId,
        source: OrderSource.CHECKOUT,
        subscriptionId: { not: null },
        status: { not: 'CANCELLED' },
        paymentStatus: 'PENDING',
        items: { some: { variantId: sub.variantId } },
      },
      select: { id: true },
    });
    if (otherOpenOrder) continue;

    await tx.subscription.update({
      where: { id: sub.id },
      data: { status: SubStatus.CANCELLED },
    });
    cancelled.push(sub.id);
  }
  return cancelled;
}
