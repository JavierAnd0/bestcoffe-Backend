import {
  BadRequestException,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  OrderSource,
  PaymentProvider,
  Prisma,
  SubAvail,
  SubStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { StripeService } from '../stripe/stripe.service';
import { TenantFeaturesService } from '../../common/features/tenant-features.service';
import type { FeatureFlags } from '../../common/features/tier-features';
import { CartService } from '../cart/cart.service';
import { PurchaseMode } from '../cart/dto/price-cart.dto';
import { variantLabel } from '../orders/variant-label';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Fallo del cobro fuera de sesión: el único caso que marca PAYMENT_FAILED. */
class OffSessionChargeError extends Error {}

type DueSubscription = {
  id: string;
  tenantId: string;
  customerId: string;
  status: SubStatus;
  frequencyDays: number;
  discountPct: number;
  nextShipAt: Date;
  shippingAddress: Prisma.JsonValue;
  customer: { id: string; stripeCustomerId: string | null };
  tenant: { paymentProvider: PaymentProvider | null };
  variant: {
    id: string;
    product: { name: string; subscriptionAvailability: SubAvail };
  };
};

/** Campos que necesita una renovación (debe coincidir con DueSubscription). */
const DUE_SELECT = {
  id: true,
  tenantId: true,
  customerId: true,
  status: true,
  frequencyDays: true,
  discountPct: true,
  nextShipAt: true,
  shippingAddress: true,
  customer: { select: { id: true, stripeCustomerId: true } },
  tenant: { select: { paymentProvider: true } },
  variant: {
    select: {
      id: true,
      product: { select: { name: true, subscriptionAvailability: true } },
    },
  },
} satisfies Prisma.SubscriptionSelect;

/** Suscripciones por página del recorrido de una tienda. */
const RENEWAL_PAGE_SIZE = 50;
/**
 * Máximo de suscripciones vencidas que se miran por tienda en una ejecución:
 * una tienda con muchas filas atascadas no consume el tiempo de las demás.
 */
const RENEWALS_PER_TENANT_MAX = 500;
/** Margen dentro del límite de la función (300 s en Vercel). */
const RENEWAL_TIME_BUDGET_MS = 240_000;

export type RenewalOutcome = 'MANUAL' | 'STRIPE' | 'SKIPPED';

@Injectable()
export class SubscriptionRenewalService {
  private readonly logger = new Logger(SubscriptionRenewalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
    private readonly features: TenantFeaturesService,
    private readonly cart: CartService,
    private readonly config: ConfigService,
    @Optional() private readonly mail?: MailService,
  ) {}

  /**
   * Procesa las suscripciones cuyo próximo envío ya llegó. Por cada una crea el
   * pedido recurrente y avanza `nextShipAt`.
   *
   * Con "pedidos sin pagos" (lo normal hoy) el pedido nace PENDIENTE, igual que
   * un pedido del checkout sin pago en línea: el operador lo cobra por fuera y
   * lo marca pagado, y la liquidación descuenta inventario. Solo en el modo de
   * pruebas de plataforma (Stripe habilitado y método guardado) se cobra fuera
   * de sesión; un rechazo de ese cobro es lo único que marca PAYMENT_FAILED.
   */
  async processDueSubscriptions(): Promise<{
    processed: number;
    skipped: number;
    errors: number;
  }> {
    const now = new Date();
    const deadline = Date.now() + RENEWAL_TIME_BUDGET_MS;
    const dueWhere: Prisma.SubscriptionWhereInput = {
      // SKIPPED_NEXT ya tiene `nextShipAt` adelantado: al llegar esa fecha se
      // renueva y vuelve a ACTIVE.
      status: { in: [SubStatus.ACTIVE, SubStatus.SKIPPED_NEXT] },
      nextShipAt: { lte: now },
      // Una tienda suspendida por cobro no cobra renovaciones a sus clientes.
      tenant: { billingStatus: { notIn: ['CANCELLED', 'INACTIVE'] } },
    };

    // Se recorre tienda por tienda (la de la renovación más antigua primero) y,
    // dentro de cada una, por cursor. Antes era un solo lote global de 50: las
    // suscripciones que no se pueden renovar (sin stock, producto archivado,
    // tienda sin suscripciones…) no avanzan `nextShipAt`, así que con 50 de
    // ellas al frente ninguna otra tienda volvía a renovar. Ahora una fila
    // atascada no bloquea a las siguientes, y una tienda con muchas solo se
    // frena a sí misma (tope por tienda).
    const tenants = await this.prisma.subscription.groupBy({
      by: ['tenantId'],
      where: dueWhere,
      _min: { nextShipAt: true },
    });
    tenants.sort(
      (a, b) =>
        (a._min.nextShipAt?.getTime() ?? 0) -
        (b._min.nextShipAt?.getTime() ?? 0),
    );

    let processed = 0;
    let skipped = 0;
    let errors = 0;

    for (const { tenantId } of tenants) {
      if (Date.now() > deadline) break;
      // Sin la capacidad `subscriptions` (plan o suspensión) no se renueva:
      // las suscripciones quedan esperando, sin pedido ni marca de fallo.
      const flags = await this.features.get(tenantId);
      if (!flags.subscriptions) continue;

      let cursor: { nextShipAt: Date; id: string } | null = null;
      let seen = 0;
      while (seen < RENEWALS_PER_TENANT_MAX && Date.now() <= deadline) {
        const page: DueSubscription[] = await this.prisma.subscription.findMany(
          {
            where: {
              ...dueWhere,
              tenantId,
              ...(cursor && {
                OR: [
                  { nextShipAt: { gt: cursor.nextShipAt } },
                  { nextShipAt: cursor.nextShipAt, id: { gt: cursor.id } },
                ],
              }),
            },
            select: DUE_SELECT,
            orderBy: [{ nextShipAt: 'asc' }, { id: 'asc' }],
            take: RENEWAL_PAGE_SIZE,
          },
        );
        if (page.length === 0) break;

        for (const sub of page) {
          try {
            const outcome = await this.renewSubscription(sub, flags);
            if (outcome === 'SKIPPED') skipped++;
            else processed++;
          } catch (err: unknown) {
            errors++;
            const message = err instanceof Error ? err.message : String(err);
            this.logger.error(
              `Error procesando renovación de suscripción ${sub.id}: ${message}`,
            );
            // Solo un cobro rechazado es un fallo de pago. Un error de otro
            // tipo (base de datos, red) se reintenta en la siguiente ejecución.
            if (err instanceof OffSessionChargeError) {
              await this.prisma.subscription
                .update({
                  where: { id: sub.id },
                  data: { status: SubStatus.PAYMENT_FAILED },
                })
                .catch(() => undefined);
            }
          }
        }

        seen += page.length;
        const last = page[page.length - 1];
        cursor = { nextShipAt: last.nextShipAt, id: last.id };
        if (page.length < RENEWAL_PAGE_SIZE) break;
      }
    }

    return { processed, skipped, errors };
  }

  /**
   * Stripe solo cobra renovaciones tras su bandera de plataforma y con un
   * método guardado (alta por SetupIntent); en cualquier otro caso el pedido es
   * manual. MercadoPago no tiene cobro fuera de sesión implementado.
   */
  private canChargeOffSession(
    sub: DueSubscription,
    flags: FeatureFlags,
  ): boolean {
    return (
      this.config.get<boolean>('stripe.checkoutEnabled') === true &&
      flags.onlinePayments &&
      sub.tenant.paymentProvider !== PaymentProvider.MERCADOPAGO &&
      !!sub.customer.stripeCustomerId
    );
  }

  private async renewSubscription(
    sub: DueSubscription,
    flags: FeatureFlags,
  ): Promise<RenewalOutcome> {
    if (sub.variant.product.subscriptionAvailability === SubAvail.NO) {
      this.logger.warn(
        `Suscripción ${sub.id}: "${sub.variant.product.name}" ya no se ofrece por suscripción; se reintenta en la próxima ejecución`,
      );
      return 'SKIPPED';
    }

    // Mismo cálculo que el checkout en modo suscripción: precio de suscripción,
    // producto activo, stock y regla de envío de la tienda.
    let priced: Awaited<ReturnType<CartService['price']>>;
    try {
      priced = await this.cart.price(
        sub.tenantId,
        {
          items: [{ variantId: sub.variant.id, quantity: 1 }],
          mode: PurchaseMode.SUBSCRIPTION,
        },
        sub.customerId,
      );
    } catch (err) {
      if (err instanceof BadRequestException) {
        this.logger.warn(
          `Suscripción ${sub.id}: variante no disponible (${err.message}); se reintenta en la próxima ejecución`,
        );
        return 'SKIPPED';
      }
      throw err;
    }
    // Igual que el checkout: sin stock no se crea el pedido (la liquidación
    // descuenta el stock al pagarse). Queda vencida y se reintenta mañana.
    if (priced.hasStockIssues) {
      this.logger.warn(
        `Suscripción ${sub.id}: sin stock de "${sub.variant.product.name}"; se reintenta en la próxima ejecución`,
      );
      return 'SKIPPED';
    }

    const line = priced.lines[0];
    const subtotalCents = priced.subtotalCents;
    // Descuento propio de la suscripción (editable en el panel), sobre el
    // precio de suscripción. Los cupones solo aplican al primer pedido.
    const discountCents =
      sub.discountPct > 0
        ? Math.round((subtotalCents * sub.discountPct) / 100)
        : 0;
    const totalCents = Math.max(
      0,
      subtotalCents - discountCents + priced.shippingCents,
    );
    if (totalCents <= 0) {
      this.logger.warn(
        `Suscripción ${sub.id}: el pedido quedaría en $0; no se crea`,
      );
      return 'SKIPPED';
    }

    const now = new Date();
    const nextShipAt = new Date(now.getTime() + sub.frequencyDays * DAY_MS);

    // Avanzar la suscripción y crear el pedido en una sola transacción. La
    // actualización condicionada a la fecha leída evita dos pedidos si dos
    // ejecuciones (cron y evento manual) toman la misma suscripción.
    const order = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.subscription.updateMany({
        where: { id: sub.id, status: sub.status, nextShipAt: sub.nextShipAt },
        data: {
          status: SubStatus.ACTIVE,
          lastShippedAt: now,
          nextShipAt,
        },
      });
      if (claimed.count === 0) return null;

      return tx.order.create({
        data: {
          tenantId: sub.tenantId,
          customerId: sub.customerId,
          source: OrderSource.SUBSCRIPTION_RENEWAL,
          status: 'RECEIVED',
          paymentStatus: 'PENDING',
          subscriptionId: sub.id,
          shippingAddress: sub.shippingAddress ?? {},
          subtotalCents,
          discountCents,
          shippingCents: priced.shippingCents,
          totalCents,
          items: {
            create: [
              {
                tenantId: sub.tenantId,
                variantId: line.variantId,
                productName: line.productName,
                variantName: variantLabel(line),
                grind: line.grind,
                sizeGrams: line.sizeGrams,
                unitCents: line.unitCents,
                quantity: 1,
                lineCents: line.lineCents,
              },
            ],
          },
        },
        select: { id: true },
      });
    });
    if (!order) return 'SKIPPED';

    if (!this.canChargeOffSession(sub, flags)) {
      // Pedido manual: el operador lo ve como cualquier pedido pendiente.
      this.notifyRenewalPending(order.id, line.productName, totalCents);
      return 'MANUAL';
    }

    // Modo de pruebas de plataforma: cobro fuera de sesión. El webhook
    // payment_intent.succeeded liquida el pedido.
    try {
      const { piId } = await this.stripe.chargeOffSession(
        sub.customer.stripeCustomerId!,
        totalCents,
        order.id,
        sub.tenantId,
      );
      await this.prisma.order.update({
        where: { id: order.id },
        data: { stripePaymentIntentId: piId },
      });
      return 'STRIPE';
    } catch (err) {
      await this.prisma.order
        .update({ where: { id: order.id }, data: { paymentStatus: 'FAILED' } })
        .catch(() => undefined);
      throw new OffSessionChargeError(
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  /** Aviso al cliente del pedido de renovación pendiente (no bloquea). */
  private notifyRenewalPending(
    orderId: string,
    productName: string,
    totalCents: number,
  ): void {
    if (!this.mail) return;
    const mail = this.mail;
    void this.prisma.order
      .findUnique({
        where: { id: orderId },
        select: {
          customer: { select: { email: true, name: true } },
          tenant: { select: { name: true } },
        },
      })
      .then((o) => {
        if (!o?.customer?.email) return;
        return mail.sendSubscriptionRenewalPending({
          to: o.customer.email,
          customerName: o.customer.name,
          orderId,
          storeName: o.tenant.name,
          productName,
          totalCents,
        });
      })
      .catch((err: unknown) =>
        this.logger.warn(
          `No se pudo enviar el aviso de renovación del pedido ${orderId}: ${String(err)}`,
        ),
      );
  }
}
