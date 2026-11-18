import { Injectable } from '@nestjs/common';
import type {
  Tenant,
  TenantBillingCycle,
  TenantBillingStatus,
  Tier,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { resolveFeatures } from '../../common/features/tier-features';
import { isSuspended } from '../../common/features/tenant-features.service';
import {
  type AnalyticsRange,
  bogotaDate,
  pctChange,
  rangeBuckets,
} from './analytics-range';
import { bucketSql, num } from './analytics-sql';
import { rangeInfo } from './admin-analytics.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const CYCLE_MONTHS: Record<TenantBillingCycle, number> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  ANNUAL: 12,
};

type BillingFields = Pick<
  Tenant,
  | 'billingType'
  | 'billingStatus'
  | 'billingCycle'
  | 'hasMaintenance'
  | 'billingAmountCents'
>;

/** ¿La tienda tiene un cobro recurrente? Suscripción, o mantenimiento. */
export function isRecurring(
  t: Pick<BillingFields, 'billingType' | 'hasMaintenance'>,
): boolean {
  return t.billingType === 'SUBSCRIPTION' || t.hasMaintenance;
}

/**
 * Aporte mensual al MRR de una tienda: el monto por cobro normalizado a un mes
 * según la frecuencia. Solo cuenta si está al día o con pago pendiente
 * (PAST_DUE sigue siendo cliente); suspendidas y canceladas no suman.
 * Devuelve null si es recurrente pero no tiene monto cargado.
 */
export function monthlyRecurringCents(t: BillingFields): number | null {
  if (!isRecurring(t) || isSuspended(t.billingStatus)) return 0;
  if (t.billingAmountCents == null) return null;
  const months = CYCLE_MONTHS[t.billingCycle ?? 'MONTHLY'];
  return Math.round(t.billingAmountCents / months);
}

/** Métricas de la plataforma (super-admin): cruzan todas las tiendas. */
@Injectable()
export class PlatformAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Ingresos ──────────────────────────────────────────────────────────────

  async revenue(range: AnalyticsRange) {
    const tenants = await this.prisma.tenant.findMany({
      select: {
        id: true,
        name: true,
        slug: true,
        tier: true,
        billingType: true,
        billingStatus: true,
        billingCycle: true,
        hasMaintenance: true,
        billingAmountCents: true,
        billingStartedAt: true,
        commissionEnabled: true,
        commissionPct: true,
      },
    });

    const commissionTenants = tenants.filter(
      (t) => t.commissionEnabled && (t.commissionPct ?? 0) > 0,
    );
    const pctOf = new Map(
      commissionTenants.map((t) => [t.id, (t.commissionPct ?? 0) / 100]),
    );

    const [gmvByTenant, gmvByTenantPrev, gmvSeries] = await Promise.all([
      this.gmvPerTenant(range.start, range.end),
      this.gmvPerTenant(range.previous.start, range.previous.end),
      this.prisma.$queryRaw<
        { bucket: string; tenantId: string; cents: unknown }[]
      >`
        SELECT ${bucketSql('"createdAt"', range.granularity)} AS bucket,
               "tenantId", SUM("totalCents") AS cents
        FROM "Order"
        WHERE "paymentStatus" = 'PAID' AND "status" <> 'CANCELLED'
          AND "createdAt" >= ${range.start} AND "createdAt" < ${range.end}
        GROUP BY 1, 2`,
    ]);

    let mrrCents = 0;
    const missingAmount: { id: string; name: string }[] = [];
    const byTier: Record<Tier, number> = { STARTER: 0, PRO: 0, BUSINESS: 0 };
    const byType: Record<string, number> = {};
    for (const t of tenants) {
      const m = monthlyRecurringCents(t);
      if (m === null) {
        missingAmount.push({ id: t.id, name: t.name });
        continue;
      }
      mrrCents += m;
      byTier[t.tier] += m;
      byType[t.billingType] = (byType[t.billingType] ?? 0) + m;
    }

    const commission = (rows: Map<string, number>) => {
      let total = 0;
      for (const [tenantId, cents] of rows) {
        total += cents * (pctOf.get(tenantId) ?? 0);
      }
      return Math.round(total);
    };
    const commissionCents = commission(gmvByTenant);
    const commissionPrevCents = commission(gmvByTenantPrev);

    // Pagos únicos registrados dentro del rango (fecha = billingStartedAt).
    const oneTimeInRange = tenants.filter(
      (t) =>
        t.billingType === 'ONE_TIME' &&
        t.billingAmountCents != null &&
        t.billingStartedAt != null &&
        t.billingStartedAt >= range.start &&
        t.billingStartedAt < range.end,
    );
    const oneTimeCents = oneTimeInRange.reduce(
      (a, t) => a + (t.billingAmountCents ?? 0),
      0,
    );

    // El MRR es estado actual: lo prorrateamos al largo del rango para
    // comparar con comisiones y pagos únicos del mismo periodo.
    const recurringInRangeCents = Math.round((mrrCents * range.days) / 30);

    const series = rangeBuckets(range).map((date) => ({
      date,
      commissionCents: 0,
    }));
    const byDate = new Map(series.map((p) => [p.date, p]));
    for (const r of gmvSeries) {
      const p = byDate.get(r.bucket);
      const pct = pctOf.get(r.tenantId);
      if (p && pct) p.commissionCents += Math.round(num(r.cents) * pct);
    }

    return {
      range: rangeInfo(range),
      mrrCents,
      arrCents: mrrCents * 12,
      mrrByTier: byTier,
      mrrByBillingType: byType,
      commissionCents,
      commissionPrevCents,
      commissionChange: pctChange(commissionCents, commissionPrevCents),
      oneTimeCents,
      recurringInRangeCents,
      totalInRangeCents: recurringInRangeCents + commissionCents + oneTimeCents,
      missingAmount,
      commissionByTenant: commissionTenants
        .map((t) => ({
          id: t.id,
          name: t.name,
          pct: t.commissionPct ?? 0,
          gmvCents: gmvByTenant.get(t.id) ?? 0,
          commissionCents: Math.round(
            (gmvByTenant.get(t.id) ?? 0) * (pctOf.get(t.id) ?? 0),
          ),
        }))
        .sort((a, b) => b.commissionCents - a.commissionCents),
      series,
    };
  }

  private async gmvPerTenant(start: Date, end: Date) {
    const rows = await this.prisma.$queryRaw<
      { tenantId: string; cents: unknown; orders: unknown }[]
    >`
      SELECT "tenantId", SUM("totalCents") AS cents, COUNT(*) AS orders
      FROM "Order"
      WHERE "paymentStatus" = 'PAID' AND "status" <> 'CANCELLED'
        AND "createdAt" >= ${start} AND "createdAt" < ${end}
      GROUP BY 1`;
    return new Map(rows.map((r) => [r.tenantId, num(r.cents)]));
  }

  // ─── GMV ───────────────────────────────────────────────────────────────────

  async gmv(range: AnalyticsRange) {
    const [tenants, current, previous, seriesRows, totals, totalsPrev] =
      await Promise.all([
        this.prisma.tenant.findMany({
          select: { id: true, name: true, slug: true, tier: true },
        }),
        this.gmvPerTenant(range.start, range.end),
        this.gmvPerTenant(range.previous.start, range.previous.end),
        this.prisma.$queryRaw<
          { bucket: string; cents: unknown; orders: unknown }[]
        >`
          SELECT ${bucketSql('"createdAt"', range.granularity)} AS bucket,
                 SUM("totalCents") AS cents, COUNT(*) AS orders
          FROM "Order"
          WHERE "paymentStatus" = 'PAID' AND "status" <> 'CANCELLED'
            AND "createdAt" >= ${range.start} AND "createdAt" < ${range.end}
          GROUP BY 1`,
        this.orderTotals(range.start, range.end),
        this.orderTotals(range.previous.start, range.previous.end),
      ]);

    const series = rangeBuckets(range).map((date) => ({
      date,
      cents: 0,
      orders: 0,
    }));
    const byDate = new Map(series.map((p) => [p.date, p]));
    for (const r of seriesRows) {
      const p = byDate.get(r.bucket);
      if (p) {
        p.cents = num(r.cents);
        p.orders = num(r.orders);
      }
    }

    return {
      range: rangeInfo(range),
      totals,
      previous: totalsPrev,
      change: {
        gmv: pctChange(totals.gmvCents, totalsPrev.gmvCents),
        orders: pctChange(totals.orders, totalsPrev.orders),
      },
      series,
      byTenant: tenants
        .map((t) => {
          const cents = current.get(t.id) ?? 0;
          const prev = previous.get(t.id) ?? 0;
          return {
            id: t.id,
            name: t.name,
            slug: t.slug,
            tier: t.tier,
            gmvCents: cents,
            previousCents: prev,
            change: pctChange(cents, prev),
          };
        })
        .filter((t) => t.gmvCents > 0 || t.previousCents > 0)
        .sort((a, b) => b.gmvCents - a.gmvCents),
    };
  }

  private async orderTotals(start: Date, end: Date) {
    const [row] = await this.prisma.$queryRaw<
      { cents: unknown; orders: unknown; stores: unknown }[]
    >`
      SELECT COALESCE(SUM("totalCents"), 0) AS cents, COUNT(*) AS orders,
             COUNT(DISTINCT "tenantId") AS stores
      FROM "Order"
      WHERE "paymentStatus" = 'PAID' AND "status" <> 'CANCELLED'
        AND "createdAt" >= ${start} AND "createdAt" < ${end}`;
    const gmvCents = num(row?.cents);
    const orders = num(row?.orders);
    return {
      gmvCents,
      orders,
      sellingStores: num(row?.stores),
      avgTicketCents: orders > 0 ? Math.round(gmvCents / orders) : 0,
    };
  }

  // ─── Crecimiento ───────────────────────────────────────────────────────────

  async growth(range: AnalyticsRange) {
    const tenants = await this.prisma.tenant.findMany({
      select: {
        tier: true,
        createdAt: true,
        cancelledAt: true,
        billingStatus: true,
      },
    });

    const series = rangeBuckets(range).map((date) => ({
      date,
      new: 0,
      cancelled: 0,
    }));
    const byDate = new Map(series.map((p) => [p.date, p]));
    const keyOf = (d: Date) => {
      const day = bogotaDate(d);
      // La cubeta es la mayor clave <= día (las claves están ordenadas).
      let k: string | undefined;
      for (const p of series) if (p.date <= day) k = p.date;
      return k;
    };

    let activeAtStart = 0;
    const byTier: Record<Tier, number> = { STARTER: 0, PRO: 0, BUSINESS: 0 };
    const byStatus: Record<TenantBillingStatus, number> = {
      ACTIVE: 0,
      PAST_DUE: 0,
      CANCELLED: 0,
      INACTIVE: 0,
    };
    for (const t of tenants) {
      byStatus[t.billingStatus] += 1;
      if (!isSuspended(t.billingStatus)) byTier[t.tier] += 1;
      if (
        t.createdAt < range.start &&
        (!t.cancelledAt || t.cancelledAt >= range.start)
      ) {
        activeAtStart += 1;
      }
      if (t.createdAt >= range.start && t.createdAt < range.end) {
        const k = keyOf(t.createdAt);
        if (k) byDate.get(k)!.new += 1;
      }
      if (
        t.cancelledAt &&
        t.cancelledAt >= range.start &&
        t.cancelledAt < range.end
      ) {
        const k = keyOf(t.cancelledAt);
        if (k) byDate.get(k)!.cancelled += 1;
      }
    }
    const newInRange = series.reduce((a, p) => a + p.new, 0);
    const cancelledInRange = series.reduce((a, p) => a + p.cancelled, 0);

    return {
      range: rangeInfo(range),
      total: tenants.length,
      liveByTier: byTier,
      byBillingStatus: byStatus,
      newInRange,
      cancelledInRange,
      churnPct:
        activeAtStart > 0
          ? Math.round((cancelledInRange / activeAtStart) * 1000) / 10
          : null,
      series,
    };
  }

  // ─── Salud por tienda ──────────────────────────────────────────────────────

  /**
   * Puntaje 0–100 por tienda con las señales que ya existen. Cada problema
   * resta puntos y deja un motivo legible, para que la lista diga por qué una
   * tienda está en riesgo y no solo que lo está.
   */
  async health(now = new Date()) {
    const d30 = new Date(now.getTime() - 30 * DAY_MS);
    const d60 = new Date(now.getTime() - 60 * DAY_MS);

    const [tenants, orders30, orders60, lastOrder, lastActivity, products] =
      await Promise.all([
        this.prisma.tenant.findMany({
          select: {
            id: true,
            name: true,
            slug: true,
            tier: true,
            features: true,
            createdAt: true,
            billingStatus: true,
            billingType: true,
            hasMaintenance: true,
            currentPeriodEnd: true,
            mpConnected: true,
            stripeConnectAccountId: true,
            domains: { select: { verified: true } },
          },
        }),
        this.countOrdersByTenant(d30, now),
        this.countOrdersByTenant(d60, d30),
        this.prisma.order.groupBy({
          by: ['tenantId'],
          _max: { createdAt: true },
        }),
        this.prisma.auditLog.groupBy({
          by: ['tenantId'],
          _max: { createdAt: true },
        }),
        this.prisma.product.groupBy({
          by: ['tenantId'],
          where: { status: 'ACTIVE' },
          _count: true,
        }),
      ]);

    const lastOrderOf = new Map(
      lastOrder.map((r) => [r.tenantId, r._max.createdAt]),
    );
    const activityOf = new Map(
      lastActivity.map((r) => [r.tenantId, r._max.createdAt]),
    );
    const productsOf = new Map(products.map((r) => [r.tenantId, r._count]));
    const daysSince = (d: Date | null | undefined) =>
      d ? Math.floor((now.getTime() - d.getTime()) / DAY_MS) : null;

    const rows = tenants.map((t) => {
      const flags = resolveFeatures(t.tier, t.features);
      const reasons: string[] = [];
      let score = 100;
      const penalize = (points: number, reason: string) => {
        score -= points;
        reasons.push(reason);
      };

      const suspended = isSuspended(t.billingStatus);
      if (suspended) {
        score = 0;
        reasons.push(
          t.billingStatus === 'CANCELLED' ? 'Cancelada' : 'Suspendida',
        );
      } else {
        // Cobro
        const overdue =
          isRecurring(t) &&
          t.currentPeriodEnd != null &&
          t.currentPeriodEnd < now;
        if (t.billingStatus === 'PAST_DUE') penalize(30, 'Pago pendiente');
        else if (overdue) penalize(20, 'Renovación vencida');

        // Actividad del operador en el panel
        const idle = daysSince(activityOf.get(t.id));
        const age = daysSince(t.createdAt) ?? 0;
        if (idle === null) {
          if (age > 14) penalize(20, 'Nadie ha usado el panel');
        } else if (idle > 30) {
          penalize(20, `Sin actividad en el panel hace ${idle} días`);
        } else if (idle > 14) {
          penalize(10, `Sin actividad en el panel hace ${idle} días`);
        }

        // Catálogo
        if ((productsOf.get(t.id) ?? 0) === 0) {
          penalize(15, 'Sin productos publicados');
        }

        // Ventas (solo si el plan vende)
        if (flags.checkout) {
          const o30 = orders30.get(t.id) ?? 0;
          const o60 = orders60.get(t.id) ?? 0;
          if (o30 === 0 && age > 30) penalize(25, 'Sin pedidos en 30 días');
          else if (o60 >= 4 && o30 < o60 / 2) {
            penalize(15, `Pedidos cayeron de ${o60} a ${o30} (30 días)`);
          }
          if (
            flags.onlinePayments &&
            !t.mpConnected &&
            !t.stripeConnectAccountId
          ) {
            penalize(10, 'Pasarela de pago sin conectar');
          }
        }

        if (
          flags.customDomain &&
          t.domains.length > 0 &&
          !t.domains.some((d) => d.verified)
        ) {
          penalize(5, 'Dominio sin verificar');
        }
      }

      score = Math.max(0, score);
      return {
        id: t.id,
        name: t.name,
        slug: t.slug,
        tier: t.tier,
        score,
        level:
          score >= 75 ? 'ok' : score >= 50 ? 'attention' : ('risk' as const),
        reasons,
        orders30: orders30.get(t.id) ?? 0,
        orders30Prev: orders60.get(t.id) ?? 0,
        daysSinceLastOrder: daysSince(lastOrderOf.get(t.id)),
        daysSinceOperatorActivity: daysSince(activityOf.get(t.id)),
        activeProducts: productsOf.get(t.id) ?? 0,
      };
    });

    rows.sort((a, b) => a.score - b.score);
    return {
      generatedAt: now.toISOString(),
      summary: {
        ok: rows.filter((r) => r.level === 'ok').length,
        attention: rows.filter((r) => r.level === 'attention').length,
        risk: rows.filter((r) => r.level === 'risk').length,
      },
      tenants: rows,
    };
  }

  private async countOrdersByTenant(start: Date, end: Date) {
    const rows = await this.prisma.order.groupBy({
      by: ['tenantId'],
      where: { createdAt: { gte: start, lt: end } },
      _count: true,
    });
    return new Map(rows.map((r) => [r.tenantId, r._count]));
  }
}
