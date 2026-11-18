/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- las respuestas HTTP llegan sin tipo (supertest) y aquí solo se comparan valores. */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import type { OperatorRole, Tier } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

/**
 * Analítica del panel de la tienda y de la plataforma. Siembra tres tiendas:
 *  - A (BUSINESS) con ventas, reembolso, pedido por cobrar y una suscripción.
 *  - B (PRO) con una venta propia, para aislamiento y bloqueo por plan.
 *  - C (STARTER), que no vende: la analítica de ventas responde 402.
 */
describe('Analítica (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let http: App;

  const RUN = `ana${Date.now().toString(36)}`;
  const DAY = 24 * 60 * 60 * 1000;
  const tenantIds: string[] = [];
  const userEmails: string[] = [];

  let jwt: JwtService;
  let secret: string;
  const tokenFor = async (email: string, id: string, mfa = false) =>
    jwt.signAsync(
      { sub: id, email, type: 'operator', ...(mfa && { mfa: true }) },
      { secret },
    );

  async function operator(tenantId: string, role: OperatorRole) {
    const email = `${role.toLowerCase()}@${RUN}-${tenantId}.test`;
    userEmails.push(email);
    const user = await prisma.user.create({
      data: { email, memberships: { create: { tenantId, role } } },
    });
    return tokenFor(email, user.id);
  }

  async function tenant(label: string, tier: Tier) {
    const t = await prisma.tenant.create({
      data: {
        slug: `${RUN}-${label}`,
        name: `Analítica ${label}`,
        tier,
        billingType: 'SUBSCRIPTION',
        billingCycle: 'QUARTERLY',
        billingAmountCents: tier === 'BUSINESS' ? 900_000_00 : null,
      },
    });
    tenantIds.push(t.id);
    const product = await prisma.product.create({
      data: {
        tenantId: t.id,
        slug: `cafe-${label}`,
        name: `Café ${label}`,
        type: 'SINGLE_ORIGIN',
        roastLevel: 5,
        flavorNotes: [],
        badges: [],
        status: 'ACTIVE',
        variants: {
          create: {
            tenantId: t.id,
            sizeGrams: 250,
            grind: 'WHOLE_BEAN',
            priceOneTime: 30_000_00,
            priceSubscription: 27_000_00,
            stock: 12,
          },
        },
      },
      include: { variants: true },
    });
    const customer = await prisma.customer.create({
      data: { tenantId: t.id, email: `c@${RUN}-${label}.test`, name: 'Ana' },
    });
    return { t, variant: product.variants[0], product, customer };
  }

  let A: Awaited<ReturnType<typeof tenant>>;
  let B: Awaited<ReturnType<typeof tenant>>;
  let C: Awaited<ReturnType<typeof tenant>>;
  let ownerA: string;
  let ordersA: string;
  let ownerB: string;
  let ownerC: string;
  let platformToken: string;

  const order = (
    s: Awaited<ReturnType<typeof tenant>>,
    data: Record<string, unknown>,
  ) =>
    prisma.order.create({
      data: {
        tenantId: s.t.id,
        customerId: s.customer.id,
        shippingAddress: { line1: 'Calle 1', city: 'Bogotá' },
        subtotalCents: 0,
        totalCents: 0,
        ...data,
      },
    });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    secret = app.get(ConfigService).get<string>('jwt.secret')!;

    A = await tenant('a', 'BUSINESS');
    B = await tenant('b', 'PRO');
    C = await tenant('c', 'STARTER');

    // A: venta suelta con cupón (2 bolsas, aún por preparar)
    await order(A, {
      paymentStatus: 'PAID',
      subtotalCents: 60_000_00,
      discountCents: 10_000_00,
      totalCents: 50_000_00,
      discountCode: 'bienvenida',
      items: {
        create: {
          tenantId: A.t.id,
          variantId: A.variant.id,
          productName: A.product.name,
          variantName: '250 g',
          grind: 'WHOLE_BEAN',
          sizeGrams: 250,
          unitCents: 30_000_00,
          quantity: 2,
          lineCents: 60_000_00,
        },
      },
    });
    // A: renovación de suscripción ya enviada
    await order(A, {
      source: 'SUBSCRIPTION_RENEWAL',
      status: 'SHIPPED',
      paymentStatus: 'PAID',
      totalCents: 24_300_00,
    });
    // A: reembolsado, cancelado pero pagado (no cuentan como venta)
    await order(A, {
      status: 'DELIVERED',
      paymentStatus: 'REFUNDED',
      totalCents: 7_000_00,
    });
    await order(A, {
      status: 'CANCELLED',
      paymentStatus: 'PAID',
      totalCents: 5_000_00,
    });
    // A: por cobrar hace 5 días (cobro por fuera)
    await order(A, {
      status: 'SHIPPED',
      paymentStatus: 'PENDING',
      totalCents: 20_000_00,
      createdAt: new Date(Date.now() - 5 * DAY),
    });
    // A: suscripción quincenal con 10 % de descuento, sale en 2 días
    await prisma.subscription.create({
      data: {
        tenantId: A.t.id,
        customerId: A.customer.id,
        variantId: A.variant.id,
        frequencyDays: 14,
        discountPct: 10,
        nextShipAt: new Date(Date.now() + 2 * DAY),
      },
    });

    // B: una venta propia que A nunca debe ver
    await order(B, {
      status: 'DELIVERED',
      paymentStatus: 'PAID',
      totalCents: 999_00,
    });

    ownerA = await operator(A.t.id, 'TENANT_OWNER');
    ordersA = await operator(A.t.id, 'TENANT_ORDERS');
    ownerB = await operator(B.t.id, 'TENANT_OWNER');
    ownerC = await operator(C.t.id, 'TENANT_OWNER');

    const ownerEmail = 'owner@plataforma.example.com';
    const owner = await prisma.user.upsert({
      where: { email: ownerEmail },
      update: {},
      create: { email: ownerEmail },
    });
    platformToken = await tokenFor(ownerEmail, owner.id, true);
  });

  afterAll(async () => {
    await prisma.order.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    await prisma.user.deleteMany({ where: { email: { in: userEmails } } });
    await app.close();
  });

  const get = (path: string, token: string, slug?: string) => {
    const req = request(http).get(path).set('Authorization', `Bearer ${token}`);
    return slug ? req.set('X-Tenant-Slug', slug) : req;
  };

  describe('panel de la tienda', () => {
    it('ventas: solo pagadas y no canceladas, con desglose y por cobrar', async () => {
      const res = await get(
        '/v1/admin/analytics/sales',
        ownerA,
        A.t.slug,
      ).expect(200);
      const body = res.body;
      expect(body.totals).toMatchObject({
        revenueCents: 74_300_00,
        orders: 2,
        avgTicketCents: 37_150_00,
        discountCents: 10_000_00,
        refundedCents: 7_000_00,
        cancelledOrders: 1,
      });
      const bySource = Object.fromEntries(
        body.bySource.map((s: { source: string; cents: number }) => [
          s.source,
          s.cents,
        ]),
      );
      expect(bySource).toMatchObject({
        CHECKOUT: 50_000_00,
        SUBSCRIPTION_RENEWAL: 24_300_00,
        GIFT: 0,
      });
      // La serie suma lo mismo que el total
      const seriesTotal = body.series.reduce(
        (a: number, p: Record<string, number>) =>
          a + p.checkoutCents + p.subscriptionCents + p.giftCents,
        0,
      );
      expect(seriesTotal).toBe(74_300_00);
      expect(body.series).toHaveLength(30);
      expect(body.pendingPayment.count).toBe(1);
      expect(body.pendingPayment.oldest[0].ageDays).toBe(5);
      expect(body.promotions).toEqual([
        {
          code: 'BIENVENIDA',
          orders: 1,
          revenueCents: 50_000_00,
          discountCents: 10_000_00,
        },
      ]);
    });

    it('aislamiento: B solo ve su propia venta', async () => {
      const res = await get(
        '/v1/admin/analytics/sales',
        ownerB,
        B.t.slug,
      ).expect(200);
      expect(res.body.totals.revenueCents).toBe(999_00);
      expect(JSON.stringify(res.body)).not.toContain('BIENVENIDA');
    });

    it('suscripciones: MRR normalizado a 30 días con su descuento', async () => {
      const res = await get(
        '/v1/admin/analytics/subscriptions',
        ownerA,
        A.t.slug,
      ).expect(200);
      expect(res.body.live).toBe(1);
      expect(res.body.mrrCents).toBe(Math.round((27_000_00 * 0.9 * 30) / 14));
      expect(res.body.frequencies).toEqual([{ days: 14, count: 1 }]);
      expect(res.body.newInRange).toBe(1);
    });

    it('plan de tueste: envío de suscripción + pedidos por preparar', async () => {
      const res = await get(
        '/v1/admin/analytics/roast-plan',
        ordersA,
        A.t.slug,
      ).expect(200);
      // 250 g de la suscripción (sale en 2 días, la siguiente en 16) +
      // 500 g del pedido recibido. El enviado no cuenta.
      expect(res.body.totals).toEqual({
        grams7: 750,
        grams14: 750,
        openOrderGrams: 500,
      });
      expect(res.body.lines[0]).toMatchObject({
        product: 'Café a',
        grind: 'WHOLE_BEAN',
        shipments14: 1,
      });
    });

    it('productos: más vendidos, molienda y días de inventario', async () => {
      const res = await get(
        '/v1/admin/analytics/products',
        ownerA,
        A.t.slug,
      ).expect(200);
      expect(res.body.top).toEqual([
        { product: 'Café a', units: 2, revenueCents: 60_000_00 },
      ]);
      expect(res.body.grindMix).toEqual([{ key: 'WHOLE_BEAN', units: 2 }]);
      // 12 en stock, 2 vendidas en 30 días → 180 días
      expect(res.body.inventory[0]).toMatchObject({ stock: 12, daysLeft: 180 });
    });

    it('clientes: en riesgo solo con analítica avanzada', async () => {
      const a = await get(
        '/v1/admin/analytics/customers',
        ownerA,
        A.t.slug,
      ).expect(200);
      expect(a.body.newCustomers).toBe(1);
      expect(Array.isArray(a.body.atRisk)).toBe(true);

      const b = await get(
        '/v1/admin/analytics/customers',
        ownerB,
        B.t.slug,
      ).expect(200);
      expect(b.body.atRisk).toBeNull();
    });

    it('bloqueos por plan y rol', async () => {
      // PRO sin analítica avanzada
      await get('/v1/admin/analytics/roast-plan', ownerB, B.t.slug).expect(402);
      // STARTER no vende
      await get('/v1/admin/analytics/sales', ownerC, C.t.slug).expect(402);
      // Despacho solo ve el plan de tueste
      await get('/v1/admin/analytics/sales', ordersA, A.t.slug).expect(403);
      // Un operador de B no entra a A
      await get('/v1/admin/analytics/sales', ownerB, A.t.slug).expect(403);
    });

    it('valida el rango', async () => {
      await get(
        '/v1/admin/analytics/sales?from=2026-11-10&to=2026-11-01',
        ownerA,
        A.t.slug,
      ).expect(400);
      await get(
        '/v1/admin/analytics/sales?granularity=hour',
        ownerA,
        A.t.slug,
      ).expect(400);
    });
  });

  describe('plataforma', () => {
    it('exige al dueño de la plataforma', async () => {
      await request(http).get('/v1/platform/analytics/revenue').expect(401);
      await get('/v1/platform/analytics/revenue', ownerA).expect(403);
    });

    it('ingresos: MRR real con el monto y la frecuencia de cada tienda', async () => {
      const res = await get(
        '/v1/platform/analytics/revenue',
        platformToken,
      ).expect(200);
      // A cobra 900.000 trimestral → 300.000 al mes (más otras tiendas de la base)
      expect(res.body.mrrCents).toBeGreaterThanOrEqual(300_000_00);
      const missing = res.body.missingAmount.map((t: { id: string }) => t.id);
      expect(missing).toContain(B.t.id);
      expect(missing).not.toContain(A.t.id);
    });

    it('GMV por tienda', async () => {
      const res = await get('/v1/platform/analytics/gmv', platformToken).expect(
        200,
      );
      const row = res.body.byTenant.find(
        (t: { id: string }) => t.id === A.t.id,
      );
      expect(row.gmvCents).toBe(74_300_00);
    });

    it('crecimiento y salud', async () => {
      const g = await get(
        '/v1/platform/analytics/growth',
        platformToken,
      ).expect(200);
      expect(g.body.newInRange).toBeGreaterThanOrEqual(3);

      const h = await get(
        '/v1/platform/analytics/health',
        platformToken,
      ).expect(200);
      const c = h.body.tenants.find((t: { id: string }) => t.id === C.t.id);
      expect(c.score).toBeLessThanOrEqual(100);
      expect(Array.isArray(c.reasons)).toBe(true);
    });
  });
});
