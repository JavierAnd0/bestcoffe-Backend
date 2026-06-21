import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentStatus, SubStatus } from '@prisma/client';

@Injectable()
export class AdminDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getKpis(tenantId: string) {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfYesterday = new Date(startOfToday);
    startOfYesterday.setDate(startOfYesterday.getDate() - 1);

    const [
      todayOrders,
      yesterdayOrders,
      monthOrders,
      activeSubs,
      lowStockVariants,
    ] = await Promise.all([
      this.prisma.order.aggregate({
        where: { tenantId, paymentStatus: PaymentStatus.PAID, createdAt: { gte: startOfToday } },
        _sum: { totalCents: true },
        _count: true,
      }),
      this.prisma.order.aggregate({
        where: {
          tenantId,
          paymentStatus: PaymentStatus.PAID,
          createdAt: { gte: startOfYesterday, lt: startOfToday },
        },
        _sum: { totalCents: true },
      }),
      this.prisma.order.aggregate({
        where: { tenantId, paymentStatus: PaymentStatus.PAID, createdAt: { gte: startOfMonth } },
        _sum: { totalCents: true },
      }),
      this.prisma.subscription.count({
        where: { tenantId, status: SubStatus.ACTIVE },
      }),
      this.prisma.productVariant.count({
        where: { tenantId: tenantId, stock: { lt: 5 }, product: { tenantId } },
      }),
    ]);

    const todaySales = todayOrders._sum.totalCents ?? 0;
    const yesterdaySales = yesterdayOrders._sum.totalCents ?? 0;
    const monthSales = monthOrders._sum.totalCents ?? 0;

    const delta =
      yesterdaySales > 0
        ? Math.round(((todaySales - yesterdaySales) / yesterdaySales) * 100)
        : null;

    const monthName = now.toLocaleDateString('es-CO', { month: 'long' });

    return [
      {
        label: 'Ventas hoy',
        value: formatCop(todaySales),
        hint: `${todayOrders._count} pedido${todayOrders._count !== 1 ? 's' : ''} pagado${todayOrders._count !== 1 ? 's' : ''}`,
        delta: delta !== null ? { value: `${delta > 0 ? '+' : ''}${delta}%`, positive: delta >= 0 } : null,
      },
      {
        label: 'Ingresos del mes',
        value: formatCop(monthSales),
        hint: `acumulado ${monthName}`,
        delta: null,
      },
      {
        label: 'Suscripciones activas',
        value: String(activeSubs),
        hint: 'renovaciones automáticas',
        delta: null,
      },
      {
        label: 'Stock bajo',
        value: String(lowStockVariants),
        hint: 'variantes con < 5 unidades',
        delta: lowStockVariants > 0 ? { value: 'Revisar', positive: false } : null,
      },
    ];
  }

  async getAlerts(tenantId: string) {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [lowStockVariants, pendingReviews, failedOrders] = await Promise.all([
      this.prisma.productVariant.findMany({
        where: { tenantId, stock: { lt: 5 }, product: { tenantId, status: 'ACTIVE' } },
        include: { product: { select: { name: true } } },
        take: 5,
        orderBy: { stock: 'asc' },
      }),
      this.prisma.review.count({
        where: { tenantId, status: 'PENDING' },
      }),
      this.prisma.order.count({
        where: { tenantId, paymentStatus: PaymentStatus.FAILED, createdAt: { gte: sevenDaysAgo } },
      }),
    ]);

    const alerts: Array<{ id: string; severity: 'danger' | 'warning' | 'info'; title: string; body: string }> = [];

    for (const v of lowStockVariants) {
      alerts.push({
        id: `low-stock-${v.id}`,
        severity: v.stock === 0 ? 'danger' : 'warning',
        title: v.stock === 0 ? 'Sin stock' : 'Stock bajo',
        body: `${v.product.name} ${v.sizeGrams}g tiene ${v.stock} unidad${v.stock !== 1 ? 'es' : ''}`,
      });
    }

    if (pendingReviews > 0) {
      alerts.push({
        id: 'pending-reviews',
        severity: 'info',
        title: 'Reseñas pendientes',
        body: `${pendingReviews} reseña${pendingReviews !== 1 ? 's' : ''} esperan aprobación`,
      });
    }

    if (failedOrders > 0) {
      alerts.push({
        id: 'failed-payments',
        severity: 'danger',
        title: 'Pagos fallidos',
        body: `${failedOrders} pago${failedOrders !== 1 ? 's' : ''} fallido${failedOrders !== 1 ? 's' : ''} en los últimos 7 días`,
      });
    }

    if (alerts.length === 0) {
      alerts.push({
        id: 'all-ok',
        severity: 'info',
        title: 'Todo en orden',
        body: 'No hay alertas activas en este momento.',
      });
    }

    return alerts;
  }

  async getSales(tenantId: string, days: number) {
    const result: number[] = [];
    const now = new Date();

    for (let i = days - 1; i >= 0; i--) {
      const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);

      const agg = await this.prisma.order.aggregate({
        where: {
          tenantId,
          paymentStatus: PaymentStatus.PAID,
          createdAt: { gte: dayStart, lt: dayEnd },
        },
        _sum: { totalCents: true },
      });

      result.push(agg._sum.totalCents ?? 0);
    }

    return result;
  }

  async listCustomers(tenantId: string, cursor?: string, limit = 30) {
    const customers = await this.prisma.customer.findMany({
      where: { tenantId },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        email: true,
        createdAt: true,
        _count: {
          select: {
            orders: { where: { paymentStatus: PaymentStatus.PAID } },
            subscriptions: { where: { status: SubStatus.ACTIVE } },
          },
        },
        orders: {
          where: { paymentStatus: PaymentStatus.PAID },
          select: { totalCents: true },
        },
      },
    });

    const hasNext = customers.length > limit;
    const items = customers.slice(0, limit).map((c) => ({
      id: c.id,
      name: c.name ?? c.email,
      email: c.email,
      ordersCount: c._count.orders,
      activeSubsCount: c._count.subscriptions,
      totalSpentCents: c.orders.reduce((sum, o) => sum + (o.totalCents ?? 0), 0),
      joinedAt: c.createdAt.toISOString(),
    }));

    return {
      items,
      nextCursor: hasNext ? items[items.length - 1]?.id : null,
    };
  }
}

function formatCop(cents: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}
