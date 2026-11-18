import { Injectable } from '@nestjs/common';
import {
  OrderSource,
  OrderStatus,
  PaymentStatus,
  Prisma,
  SubStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  type AnalyticsRange,
  pctChange,
  rangeBuckets,
} from './analytics-range';
import { bucketSql, num } from './analytics-sql';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Pedido que cuenta como venta: pagado y no cancelado. */
const SOLD = Prisma.sql`"paymentStatus" = 'PAID' AND "status" <> 'CANCELLED'`;

/** Suscripciones que generan ingreso recurrente. */
const LIVE_SUBS: SubStatus[] = [SubStatus.ACTIVE, SubStatus.SKIPPED_NEXT];

export interface SalesTotals {
  revenueCents: number;
  orders: number;
  avgTicketCents: number;
  discountCents: number;
  refundedCents: number;
  refundedOrders: number;
  cancelledOrders: number;
}

/**
 * Analítica del panel de la tienda. Todas las consultas filtran por `tenantId`
 * (lo resuelve el TenantGuard); ninguna recibe identificadores del cliente.
 */
@Injectable()
export class AdminAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Ventas ────────────────────────────────────────────────────────────────

  async sales(tenantId: string, range: AnalyticsRange) {
    const [current, previous, bySource, seriesRows, pending, promotions] =
      await Promise.all([
        this.salesTotals(tenantId, range.start, range.end),
        this.salesTotals(tenantId, range.previous.start, range.previous.end),
        this.prisma.$queryRaw<
          { source: OrderSource; cents: unknown; orders: unknown }[]
        >`
          SELECT "source", SUM("totalCents") AS cents, COUNT(*) AS orders
          FROM "Order"
          WHERE "tenantId" = ${tenantId} AND ${SOLD}
            AND "createdAt" >= ${range.start} AND "createdAt" < ${range.end}
          GROUP BY "source"`,
        this.prisma.$queryRaw<
          {
            bucket: string;
            source: OrderSource;
            cents: unknown;
            orders: unknown;
          }[]
        >`
          SELECT ${bucketSql('"createdAt"', range.granularity)} AS bucket,
                 "source", SUM("totalCents") AS cents, COUNT(*) AS orders
          FROM "Order"
          WHERE "tenantId" = ${tenantId} AND ${SOLD}
            AND "createdAt" >= ${range.start} AND "createdAt" < ${range.end}
          GROUP BY 1, 2`,
        this.pendingPayment(tenantId),
        this.prisma.$queryRaw<
          { code: string; orders: unknown; cents: unknown; discount: unknown }[]
        >`
          SELECT upper("discountCode") AS code, COUNT(*) AS orders,
                 SUM("totalCents") AS cents, SUM("discountCents") AS discount
          FROM "Order"
          WHERE "tenantId" = ${tenantId} AND ${SOLD}
            AND "discountCode" IS NOT NULL
            AND "createdAt" >= ${range.start} AND "createdAt" < ${range.end}
          GROUP BY 1
          ORDER BY 3 DESC
          LIMIT 20`,
      ]);

    const series = rangeBuckets(range).map((date) => ({
      date,
      checkoutCents: 0,
      subscriptionCents: 0,
      giftCents: 0,
      orders: 0,
    }));
    const byDate = new Map(series.map((p) => [p.date, p]));
    for (const r of seriesRows) {
      const p = byDate.get(r.bucket);
      if (!p) continue;
      const cents = num(r.cents);
      if (r.source === OrderSource.SUBSCRIPTION_RENEWAL) {
        p.subscriptionCents += cents;
      } else if (r.source === OrderSource.GIFT) p.giftCents += cents;
      else p.checkoutCents += cents;
      p.orders += num(r.orders);
    }

    return {
      range: rangeInfo(range),
      totals: current,
      previous,
      change: {
        revenue: pctChange(current.revenueCents, previous.revenueCents),
        orders: pctChange(current.orders, previous.orders),
        avgTicket: pctChange(current.avgTicketCents, previous.avgTicketCents),
      },
      bySource: Object.values(OrderSource).map((source) => {
        const r = bySource.find((x) => x.source === source);
        return {
          source,
          cents: num(r?.cents),
          orders: num(r?.orders),
        };
      }),
      series,
      pendingPayment: pending,
      promotions: promotions.map((p) => ({
        code: p.code,
        orders: num(p.orders),
        revenueCents: num(p.cents),
        discountCents: num(p.discount),
      })),
    };
  }

  private async salesTotals(
    tenantId: string,
    start: Date,
    end: Date,
  ): Promise<SalesTotals> {
    const [row] = await this.prisma.$queryRaw<
      {
        revenue: unknown;
        orders: unknown;
        discount: unknown;
        refunded: unknown;
        refunded_orders: unknown;
        cancelled: unknown;
      }[]
    >`
      SELECT
        COALESCE(SUM("totalCents") FILTER (WHERE ${SOLD}), 0) AS revenue,
        COUNT(*) FILTER (WHERE ${SOLD}) AS orders,
        COALESCE(SUM("discountCents") FILTER (WHERE ${SOLD}), 0) AS discount,
        COALESCE(SUM("totalCents") FILTER (WHERE "paymentStatus" = 'REFUNDED'), 0) AS refunded,
        COUNT(*) FILTER (WHERE "paymentStatus" = 'REFUNDED') AS refunded_orders,
        COUNT(*) FILTER (WHERE "status" = 'CANCELLED') AS cancelled
      FROM "Order"
      WHERE "tenantId" = ${tenantId}
        AND "createdAt" >= ${start} AND "createdAt" < ${end}`;
    const revenueCents = num(row?.revenue);
    const orders = num(row?.orders);
    return {
      revenueCents,
      orders,
      avgTicketCents: orders > 0 ? Math.round(revenueCents / orders) : 0,
      discountCents: num(row?.discount),
      refundedCents: num(row?.refunded),
      refundedOrders: num(row?.refunded_orders),
      cancelledOrders: num(row?.cancelled),
    };
  }

  /**
   * Pedidos sin pagar (cobro por fuera: transferencia / contra entrega) con su
   * antigüedad. Es estado actual, no depende del rango.
   */
  private async pendingPayment(tenantId: string) {
    const where = {
      tenantId,
      paymentStatus: PaymentStatus.PENDING,
      status: { not: OrderStatus.CANCELLED },
    };
    const [agg, oldest] = await Promise.all([
      this.prisma.order.aggregate({
        where,
        _sum: { totalCents: true },
        _count: true,
      }),
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        take: 8,
        select: {
          id: true,
          totalCents: true,
          createdAt: true,
          customer: { select: { name: true, email: true } },
        },
      }),
    ]);
    const now = Date.now();
    return {
      count: agg._count,
      cents: agg._sum.totalCents ?? 0,
      oldest: oldest.map((o) => ({
        id: o.id,
        customer: o.customer.name ?? o.customer.email,
        totalCents: o.totalCents,
        ageDays: Math.floor((now - o.createdAt.getTime()) / DAY_MS),
      })),
    };
  }

  // ─── Suscripciones ─────────────────────────────────────────────────────────

  async subscriptions(tenantId: string, range: AnalyticsRange) {
    const [byStatus, live, newRows, cancelledRows, activeAtStart] =
      await Promise.all([
        this.prisma.subscription.groupBy({
          by: ['status'],
          where: { tenantId },
          _count: true,
        }),
        this.prisma.subscription.findMany({
          where: { tenantId, status: { in: LIVE_SUBS } },
          select: {
            frequencyDays: true,
            discountPct: true,
            variant: {
              select: { priceSubscription: true, priceOneTime: true },
            },
          },
        }),
        this.prisma.$queryRaw<{ bucket: string; n: unknown }[]>`
          SELECT ${bucketSql('"createdAt"', range.granularity)} AS bucket, COUNT(*) AS n
          FROM "Subscription"
          WHERE "tenantId" = ${tenantId}
            AND "createdAt" >= ${range.start} AND "createdAt" < ${range.end}
          GROUP BY 1`,
        // Sin tabla de eventos: la fecha de baja se aproxima con updatedAt de
        // las canceladas (la Fase B del plan agrega SubscriptionEvent).
        this.prisma.$queryRaw<{ bucket: string; n: unknown }[]>`
          SELECT ${bucketSql('"updatedAt"', range.granularity)} AS bucket, COUNT(*) AS n
          FROM "Subscription"
          WHERE "tenantId" = ${tenantId} AND "status" = 'CANCELLED'
            AND "updatedAt" >= ${range.start} AND "updatedAt" < ${range.end}
          GROUP BY 1`,
        // Base del churn: creadas antes del rango y no canceladas antes de él.
        this.prisma.subscription.count({
          where: {
            tenantId,
            createdAt: { lt: range.start },
            OR: [
              { status: { not: SubStatus.CANCELLED } },
              { updatedAt: { gte: range.start } },
            ],
          },
        }),
      ]);

    const counts = Object.fromEntries(
      Object.values(SubStatus).map((s) => [
        s,
        byStatus.find((b) => b.status === s)?._count ?? 0,
      ]),
    ) as Record<SubStatus, number>;

    let mrrCents = 0;
    const freq = new Map<number, number>();
    for (const s of live) {
      const price = s.variant.priceSubscription ?? s.variant.priceOneTime;
      const net = price * (1 - s.discountPct / 100);
      mrrCents += (net * 30) / Math.max(s.frequencyDays, 1);
      freq.set(s.frequencyDays, (freq.get(s.frequencyDays) ?? 0) + 1);
    }

    const series = rangeBuckets(range).map((date) => ({
      date,
      new: 0,
      cancelled: 0,
    }));
    const byDate = new Map(series.map((p) => [p.date, p]));
    for (const r of newRows) {
      const p = byDate.get(r.bucket);
      if (p) p.new = num(r.n);
    }
    for (const r of cancelledRows) {
      const p = byDate.get(r.bucket);
      if (p) p.cancelled = num(r.n);
    }
    const newInRange = series.reduce((a, p) => a + p.new, 0);
    const cancelledInRange = series.reduce((a, p) => a + p.cancelled, 0);

    return {
      range: rangeInfo(range),
      counts,
      live: live.length,
      mrrCents: Math.round(mrrCents),
      avgRevenuePerSubCents:
        live.length > 0 ? Math.round(mrrCents / live.length) : 0,
      frequencies: [...freq.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([days, count]) => ({ days, count })),
      newInRange,
      cancelledInRange,
      churnPct:
        activeAtStart > 0
          ? Math.round((cancelledInRange / activeAtStart) * 1000) / 10
          : null,
      series,
      approximate: true,
    };
  }

  /**
   * Plan de tueste: café a despachar en los próximos 7 y 14 días. Suma los
   * envíos programados de suscripciones (con su frecuencia, una semanal cuenta
   * dos veces en 14 días) y los pedidos pagados o por cobrar que aún no salen.
   */
  async roastPlan(tenantId: string, now = new Date()) {
    const horizon14 = new Date(now.getTime() + 14 * DAY_MS);
    const horizon7 = new Date(now.getTime() + 7 * DAY_MS);

    const [subs, openItems] = await Promise.all([
      this.prisma.subscription.findMany({
        where: {
          tenantId,
          status: { in: LIVE_SUBS },
          nextShipAt: { lt: horizon14 },
        },
        select: {
          status: true,
          frequencyDays: true,
          nextShipAt: true,
          variant: {
            select: {
              sizeGrams: true,
              grind: true,
              product: { select: { name: true, type: true } },
            },
          },
        },
      }),
      this.prisma.orderItem.findMany({
        where: {
          tenantId,
          order: {
            tenantId,
            status: { in: [OrderStatus.RECEIVED, OrderStatus.PREPARING] },
            paymentStatus: { in: [PaymentStatus.PAID, PaymentStatus.PENDING] },
          },
        },
        select: {
          productName: true,
          grind: true,
          sizeGrams: true,
          quantity: true,
        },
      }),
    ]);

    type Line = {
      product: string;
      grind: string;
      grams7: number;
      grams14: number;
      shipments7: number;
      shipments14: number;
    };
    const lines = new Map<string, Line>();
    const line = (product: string, grind: string) => {
      const key = `${product}::${grind}`;
      let l = lines.get(key);
      if (!l) {
        l = {
          product,
          grind,
          grams7: 0,
          grams14: 0,
          shipments7: 0,
          shipments14: 0,
        };
        lines.set(key, l);
      }
      return l;
    };

    for (const s of subs) {
      if (s.variant.product.type === 'ACCESSORY') continue;
      const step = Math.max(s.frequencyDays, 1) * DAY_MS;
      let t = s.nextShipAt.getTime();
      // Un envío vencido (renovación pendiente) cuenta como inmediato.
      if (t < now.getTime()) t = now.getTime();
      // SKIPPED_NEXT: el próximo envío no sale, arranca en el siguiente.
      if (s.status === SubStatus.SKIPPED_NEXT) t += step;
      const l = line(s.variant.product.name, s.variant.grind);
      for (; t < horizon14.getTime(); t += step) {
        l.grams14 += s.variant.sizeGrams;
        l.shipments14 += 1;
        if (t < horizon7.getTime()) {
          l.grams7 += s.variant.sizeGrams;
          l.shipments7 += 1;
        }
      }
    }

    let openGrams = 0;
    for (const i of openItems) {
      const grams = i.sizeGrams * i.quantity;
      if (grams <= 0) continue;
      const l = line(i.productName, i.grind);
      l.grams7 += grams;
      l.grams14 += grams;
      openGrams += grams;
    }

    const rows = [...lines.values()]
      .filter((l) => l.grams14 > 0)
      .sort((a, b) => b.grams14 - a.grams14);
    return {
      generatedAt: now.toISOString(),
      totals: {
        grams7: rows.reduce((a, l) => a + l.grams7, 0),
        grams14: rows.reduce((a, l) => a + l.grams14, 0),
        openOrderGrams: openGrams,
      },
      lines: rows,
    };
  }

  // ─── Productos ─────────────────────────────────────────────────────────────

  async products(tenantId: string, range: AnalyticsRange) {
    const thirtyDaysAgo = new Date(Date.now() - 30 * DAY_MS);
    const [top, grind, size, velocity, variants, ratings] = await Promise.all([
      this.prisma.$queryRaw<
        { product: string; units: unknown; cents: unknown }[]
      >`
        SELECT i."productName" AS product, SUM(i."quantity") AS units, SUM(i."lineCents") AS cents
        FROM "OrderItem" i JOIN "Order" o ON o."id" = i."orderId"
        WHERE o."tenantId" = ${tenantId} AND i."tenantId" = ${tenantId}
          AND o."paymentStatus" = 'PAID' AND o."status" <> 'CANCELLED'
          AND o."createdAt" >= ${range.start} AND o."createdAt" < ${range.end}
        GROUP BY 1 ORDER BY 3 DESC LIMIT 10`,
      this.mix(tenantId, range, Prisma.sql`i."grind"::text`),
      this.mix(tenantId, range, Prisma.sql`i."sizeGrams"::text`),
      this.prisma.$queryRaw<{ variantId: string; units: unknown }[]>`
        SELECT i."variantId", SUM(i."quantity") AS units
        FROM "OrderItem" i JOIN "Order" o ON o."id" = i."orderId"
        WHERE o."tenantId" = ${tenantId} AND i."tenantId" = ${tenantId}
          AND o."paymentStatus" = 'PAID' AND o."status" <> 'CANCELLED'
          AND o."createdAt" >= ${thirtyDaysAgo}
        GROUP BY 1`,
      this.prisma.productVariant.findMany({
        where: { tenantId, product: { tenantId, status: 'ACTIVE' } },
        select: {
          id: true,
          sizeGrams: true,
          grind: true,
          stock: true,
          product: { select: { name: true, type: true } },
        },
      }),
      this.prisma.review.groupBy({
        by: ['productId'],
        where: { tenantId, status: 'APPROVED' },
        _avg: { rating: true },
        _count: true,
      }),
    ]);

    const sold = new Map(velocity.map((v) => [v.variantId, num(v.units)]));
    const inventory = variants
      .map((v) => {
        const perDay = (sold.get(v.id) ?? 0) / 30;
        return {
          variantId: v.id,
          product: v.product.name,
          isAccessory: v.product.type === 'ACCESSORY',
          sizeGrams: v.sizeGrams,
          grind: v.grind,
          stock: v.stock,
          unitsPerDay: Math.round(perDay * 100) / 100,
          daysLeft: perDay > 0 ? Math.floor(v.stock / perDay) : null,
        };
      })
      // Primero lo que se agota antes; lo que no rota va al final.
      .sort(
        (a, b) =>
          (a.daysLeft ?? Number.MAX_SAFE_INTEGER) -
          (b.daysLeft ?? Number.MAX_SAFE_INTEGER),
      );

    const productNames = await this.prisma.product.findMany({
      where: { tenantId, id: { in: ratings.map((r) => r.productId) } },
      select: { id: true, name: true },
    });
    const nameOf = new Map(productNames.map((p) => [p.id, p.name]));

    return {
      range: rangeInfo(range),
      top: top.map((t) => ({
        product: t.product,
        units: num(t.units),
        revenueCents: num(t.cents),
      })),
      grindMix: grind,
      sizeMix: size,
      inventory,
      ratings: ratings
        .map((r) => ({
          product: nameOf.get(r.productId) ?? '—',
          avg: Math.round((r._avg.rating ?? 0) * 10) / 10,
          count: r._count,
        }))
        .sort((a, b) => b.count - a.count),
    };
  }

  private async mix(tenantId: string, range: AnalyticsRange, key: Prisma.Sql) {
    const rows = await this.prisma.$queryRaw<{ key: string; units: unknown }[]>`
      SELECT ${key} AS key, SUM(i."quantity") AS units
      FROM "OrderItem" i JOIN "Order" o ON o."id" = i."orderId"
      WHERE o."tenantId" = ${tenantId} AND i."tenantId" = ${tenantId}
        AND o."paymentStatus" = 'PAID' AND o."status" <> 'CANCELLED'
        AND o."createdAt" >= ${range.start} AND o."createdAt" < ${range.end}
      GROUP BY 1 ORDER BY 2 DESC`;
    return rows.map((r) => ({ key: r.key, units: num(r.units) }));
  }

  // ─── Clientes ──────────────────────────────────────────────────────────────

  async customers(
    tenantId: string,
    range: AnalyticsRange,
    opts: { includeAtRisk: boolean },
  ) {
    const [perCustomer, liveSubs, newsletter] = await Promise.all([
      this.prisma.$queryRaw<
        {
          customerId: string;
          orders: unknown;
          cents: unknown;
          first: Date;
          last: Date;
          in_range: unknown;
          in_range_cents: unknown;
        }[]
      >`
        SELECT "customerId",
               COUNT(*) AS orders,
               SUM("totalCents") AS cents,
               MIN("createdAt") AS first,
               MAX("createdAt") AS last,
               COUNT(*) FILTER (WHERE "createdAt" >= ${range.start} AND "createdAt" < ${range.end}) AS in_range,
               COALESCE(SUM("totalCents") FILTER (WHERE "createdAt" >= ${range.start} AND "createdAt" < ${range.end}), 0) AS in_range_cents
        FROM "Order"
        WHERE "tenantId" = ${tenantId} AND ${SOLD} AND "createdAt" < ${range.end}
        GROUP BY 1`,
      this.prisma.subscription.findMany({
        where: { tenantId, status: { in: [...LIVE_SUBS, SubStatus.PAUSED] } },
        select: { customerId: true },
        distinct: ['customerId'],
      }),
      this.newsletter(tenantId, range),
    ]);

    let newCustomers = 0;
    let returning = 0;
    let repeaters = 0;
    let lifetimeCents = 0;
    for (const c of perCustomer) {
      const orders = num(c.orders);
      lifetimeCents += num(c.cents);
      if (orders >= 2) repeaters += 1;
      if (num(c.in_range) > 0) {
        if (c.first >= range.start) newCustomers += 1;
        else returning += 1;
      }
    }
    const buyers = perCustomer.length;

    const topIds = perCustomer
      .filter((c) => num(c.in_range) > 0)
      .sort((a, b) => num(b.in_range_cents) - num(a.in_range_cents))
      .slice(0, 5);

    // En riesgo: compran con cierta regularidad (≥2 pedidos), no tienen una
    // suscripción viva y llevan más del doble de su intervalo habitual sin
    // volver (mínimo 21 días para no alarmar por compradores muy frecuentes).
    const withSub = new Set(liveSubs.map((s) => s.customerId));
    const now = Date.now();
    const atRiskRaw = opts.includeAtRisk
      ? perCustomer
          .filter((c) => num(c.orders) >= 2 && !withSub.has(c.customerId))
          .map((c) => {
            const orders = num(c.orders);
            const intervalDays =
              (c.last.getTime() - c.first.getTime()) / DAY_MS / (orders - 1);
            const daysSince = Math.floor((now - c.last.getTime()) / DAY_MS);
            return { c, orders, intervalDays, daysSince };
          })
          .filter((x) => x.daysSince > Math.max(2 * x.intervalDays, 21))
          .sort((a, b) => num(b.c.cents) - num(a.c.cents))
          .slice(0, 25)
      : [];

    const ids = [
      ...new Set([
        ...topIds.map((c) => c.customerId),
        ...atRiskRaw.map((x) => x.c.customerId),
      ]),
    ];
    const people = await this.prisma.customer.findMany({
      where: { tenantId, id: { in: ids } },
      select: { id: true, name: true, email: true },
    });
    const who = new Map(people.map((p) => [p.id, p]));
    const label = (id: string) => {
      const p = who.get(id);
      return { name: p?.name ?? p?.email ?? '—', email: p?.email ?? '' };
    };

    return {
      range: rangeInfo(range),
      buyersInRange: newCustomers + returning,
      newCustomers,
      returningCustomers: returning,
      repeatRatePct:
        buyers > 0 ? Math.round((repeaters / buyers) * 1000) / 10 : null,
      avgLifetimeValueCents:
        buyers > 0 ? Math.round(lifetimeCents / buyers) : 0,
      top: topIds.map((c) => ({
        customerId: c.customerId,
        ...label(c.customerId),
        orders: num(c.in_range),
        cents: num(c.in_range_cents),
      })),
      atRisk: opts.includeAtRisk
        ? atRiskRaw.map((x) => ({
            customerId: x.c.customerId,
            ...label(x.c.customerId),
            orders: x.orders,
            lifetimeCents: num(x.c.cents),
            lastOrderAt: x.c.last.toISOString(),
            daysSinceLastOrder: x.daysSince,
            usualIntervalDays: Math.round(x.intervalDays),
          }))
        : null,
      newsletter,
    };
  }

  private async newsletter(tenantId: string, range: AnalyticsRange) {
    const [active, joined, left] = await Promise.all([
      this.prisma.newsletterSubscriber.count({
        where: { tenantId, unsubscribedAt: null },
      }),
      this.prisma.newsletterSubscriber.count({
        where: {
          tenantId,
          subscribedAt: { gte: range.start, lt: range.end },
        },
      }),
      this.prisma.newsletterSubscriber.count({
        where: {
          tenantId,
          unsubscribedAt: { gte: range.start, lt: range.end },
        },
      }),
    ]);
    return { active, joined, left };
  }
}

export function rangeInfo(range: AnalyticsRange) {
  return {
    from: range.from,
    to: range.to,
    granularity: range.granularity,
    days: range.days,
    previous: { from: range.previous.from, to: range.previous.to },
  };
}
