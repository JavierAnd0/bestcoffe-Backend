import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

/**
 * Aislamiento entre tiendas. Se siembran dos tiendas completas (A y B) y se
 * comprueba, por cada puerta de entrada, que con el contexto de A nunca se
 * lee ni se toca nada de B: catálogo, blog, carrito, cupones, pedidos de
 * cliente y panel de operador.
 *
 * Es la red de seguridad del modelo multi-tenant: toda query debe filtrar por
 * tenantId, y aquí se nota si alguna deja de hacerlo.
 */
describe('Aislamiento entre tiendas (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let http: App;

  const RUN = `iso${Date.now().toString(36)}`;
  const slugA = `${RUN}-a`;
  const slugB = `${RUN}-b`;

  type Seed = {
    tenantId: string;
    productSlug: string;
    variantId: string;
    collectionSlug: string;
    blogSlug: string;
    blogId: string;
    guideId: string;
    guideSlug: string;
    locationId: string;
    discountCode: string;
    customerId: string;
    customerToken: string;
    orderId: string;
    operatorToken: string;
  };
  let a: Seed;
  let b: Seed;

  async function seed(slug: string, label: string): Promise<Seed> {
    const jwt = app.get(JwtService);
    const config = app.get(ConfigService);

    const tenant = await prisma.tenant.create({
      data: { slug, name: `Tienda ${label}`, tier: 'BUSINESS' },
    });
    const product = await prisma.product.create({
      data: {
        tenantId: tenant.id,
        slug: `cafe-${label}`,
        name: `Café secreto ${label}`,
        type: 'SINGLE_ORIGIN',
        roastLevel: 5,
        flavorNotes: ['cacao'],
        badges: [],
        status: 'ACTIVE',
        subscriptionAvailability: 'YES',
        variants: {
          create: {
            tenantId: tenant.id,
            sizeGrams: 250,
            grind: 'WHOLE_BEAN',
            priceOneTime: 30_000_00,
            priceSubscription: 27_000_00,
            stock: 10,
          },
        },
      },
      include: { variants: true },
    });
    const collection = await prisma.collection.create({
      data: {
        tenantId: tenant.id,
        slug: `coleccion-${label}`,
        name: `Colección ${label}`,
        products: { create: { productId: product.id } },
      },
    });
    const post = await prisma.blogPost.create({
      data: {
        tenantId: tenant.id,
        slug: `articulo-${label}`,
        title: `Artículo privado ${label}`,
        body: 'contenido',
        publishedAt: new Date(Date.now() - 60_000),
      },
    });
    const guide = await prisma.brewGuide.create({
      data: {
        tenantId: tenant.id,
        slug: `guia-${label}`,
        title: `Guía privada ${label}`,
        body: 'pasos',
      },
    });
    const location = await prisma.storeLocation.create({
      data: {
        tenantId: tenant.id,
        name: `Sede privada ${label}`,
        address: `Calle ${label}`,
        city: 'Bogotá',
      },
    });
    const discount = await prisma.discountCode.create({
      data: {
        tenantId: tenant.id,
        code: `SOLO${label.toUpperCase()}`,
        type: 'PERCENTAGE',
        value: 50,
      },
    });
    const customer = await prisma.customer.create({
      data: {
        tenantId: tenant.id,
        email: `cliente@${slug}.test`,
        name: `Cliente ${label}`,
      },
    });
    const order = await prisma.order.create({
      data: {
        tenantId: tenant.id,
        customerId: customer.id,
        shippingAddress: { line1: `Calle ${label}`, city: 'Bogotá' },
        subtotalCents: 30_000_00,
        totalCents: 30_000_00,
        items: {
          create: {
            tenantId: tenant.id,
            variantId: product.variants[0].id,
            productName: product.name,
            variantName: '250g',
            grind: 'WHOLE_BEAN',
            sizeGrams: 250,
            unitCents: 30_000_00,
            quantity: 1,
            lineCents: 30_000_00,
          },
        },
      },
    });
    const operator = await prisma.user.create({
      data: {
        email: `operador@${slug}.test`,
        memberships: { create: { tenantId: tenant.id, role: 'TENANT_OWNER' } },
      },
    });

    const customerToken = await jwt.signAsync(
      {
        sub: customer.id,
        email: customer.email,
        tenantId: tenant.id,
        type: 'customer',
      },
      { secret: config.get<string>('jwt.customerSecret') },
    );
    const operatorToken = await jwt.signAsync(
      { sub: operator.id, email: operator.email, type: 'operator' },
      { secret: config.get<string>('jwt.secret') },
    );

    return {
      tenantId: tenant.id,
      productSlug: product.slug,
      variantId: product.variants[0].id,
      collectionSlug: collection.slug,
      blogSlug: post.slug,
      blogId: post.id,
      guideId: guide.id,
      guideSlug: guide.slug,
      locationId: location.id,
      discountCode: discount.code,
      customerId: customer.id,
      customerToken,
      orderId: order.id,
      operatorToken,
    };
  }

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

    a = await seed(slugA, 'a');
    b = await seed(slugB, 'b');
  });

  afterAll(async () => {
    // Los pedidos no caen en cascada desde el cliente: se borran primero.
    const tenantIds = [a?.tenantId, b?.tenantId].filter(Boolean);
    await prisma.order.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    await prisma.user.deleteMany({
      where: { email: { endsWith: `${RUN}-a.test` } },
    });
    await prisma.user.deleteMany({
      where: { email: { endsWith: `${RUN}-b.test` } },
    });
    await app.close();
  });

  const asTenant = (slug: string) => ({ 'X-Tenant-Slug': slug });
  const bodyText = (res: request.Response) => JSON.stringify(res.body);

  describe('catálogo público', () => {
    it('el listado de A no contiene productos de B', async () => {
      const res = await request(http)
        .get('/v1/products')
        .set(asTenant(slugA))
        .expect(200);
      expect(bodyText(res)).toContain(a.productSlug);
      expect(bodyText(res)).not.toContain(b.productSlug);
      expect(bodyText(res)).not.toContain('Café secreto b');
    });

    it('el producto de B no existe visto desde A', async () => {
      await request(http)
        .get(`/v1/products/${b.productSlug}`)
        .set(asTenant(slugA))
        .expect(404);
    });

    it('las colecciones de B no se listan ni se abren desde A', async () => {
      const list = await request(http)
        .get('/v1/collections')
        .set(asTenant(slugA))
        .expect(200);
      expect(bodyText(list)).not.toContain(b.collectionSlug);
      await request(http)
        .get(`/v1/collections/${b.collectionSlug}`)
        .set(asTenant(slugA))
        .expect(404);
    });

    it('el blog de B no se lista ni se abre desde A', async () => {
      const list = await request(http)
        .get('/v1/blog')
        .set(asTenant(slugA))
        .expect(200);
      expect(bodyText(list)).not.toContain(b.blogSlug);
      await request(http)
        .get(`/v1/blog/${b.blogSlug}`)
        .set(asTenant(slugA))
        .expect(404);
    });

    it('sin tienda declarada no se devuelve nada', async () => {
      await request(http).get('/v1/products').expect(400);
    });
  });

  describe('carrito y cupones', () => {
    it('una variante de B no se puede cotizar en A', async () => {
      await request(http)
        .post('/v1/cart/price')
        .set(asTenant(slugA))
        .send({ items: [{ variantId: b.variantId, quantity: 1 }] })
        .expect(400);
    });

    it('un cupón de B no descuenta en A', async () => {
      const res = await request(http)
        .post('/v1/cart/price')
        .set(asTenant(slugA))
        .send({
          items: [{ variantId: a.variantId, quantity: 1 }],
          discountCode: b.discountCode,
        });
      expect(res.status).toBeLessThan(300);
      const body = res.body as {
        discountCents: number;
        discount?: { valid: boolean };
      };
      expect(body.discountCents).toBe(0);
      expect(body.discount?.valid).toBe(false);
    });

    it('el cupón propio sí descuenta (control)', async () => {
      const res = await request(http)
        .post('/v1/cart/price')
        .set(asTenant(slugA))
        .send({
          items: [{ variantId: a.variantId, quantity: 1 }],
          discountCode: a.discountCode,
        });
      expect(res.status).toBeLessThan(300);
      expect((res.body as { discountCents: number }).discountCents).toBe(
        15_000_00,
      );
    });
  });

  describe('sesión de cliente', () => {
    const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

    it('el cliente de A solo ve sus pedidos', async () => {
      const res = await request(http)
        .get('/v1/orders')
        .set(auth(a.customerToken))
        .expect(200);
      expect(bodyText(res)).toContain(a.orderId);
      expect(bodyText(res)).not.toContain(b.orderId);
    });

    it('el cliente de A no puede abrir un pedido de B', async () => {
      await request(http)
        .get(`/v1/orders/${b.orderId}`)
        .set(auth(a.customerToken))
        .expect(404);
    });

    it('el token de A se rechaza si la petición declara la tienda B', async () => {
      await request(http)
        .get('/v1/orders')
        .set(auth(a.customerToken))
        .set(asTenant(slugB))
        .expect(403);
    });

    it('un token de cliente no sirve como token de operador', async () => {
      await request(http)
        .get('/v1/admin/orders')
        .set(auth(a.customerToken))
        .set(asTenant(slugA))
        .expect(401);
    });
  });

  describe('accesorios apagados', () => {
    it('no se listan, abren, cotizan ni recomiendan sin la feature', async () => {
      const slug = `${RUN}-c`;
      const tenant = await prisma.tenant.create({
        data: {
          slug,
          name: 'Tienda c',
          tier: 'BUSINESS',
          features: { accessories: false },
        },
      });
      const make = (name: string, type: 'ACCESSORY' | 'BLEND') =>
        prisma.product.create({
          data: {
            tenantId: tenant.id,
            slug: name,
            name,
            type,
            roastLevel: type === 'ACCESSORY' ? 0 : 5,
            flavorNotes: ['cacao'],
            badges: [],
            status: 'ACTIVE',
            subscriptionAvailability: type === 'ACCESSORY' ? 'NO' : 'YES',
            variants: {
              create: {
                tenantId: tenant.id,
                sizeGrams: 250,
                grind: 'WHOLE_BEAN',
                priceOneTime: 10_000_00,
                stock: 5,
              },
            },
          },
          include: { variants: true },
        });
      const accessory = await make('molino', 'ACCESSORY');
      await make('cafe', 'BLEND');

      try {
        const list = await request(http)
          .get('/v1/products')
          .set(asTenant(slug))
          .expect(200);
        expect(bodyText(list)).toContain('"cafe"');
        expect(bodyText(list)).not.toContain('"molino"');

        await request(http)
          .get('/v1/products/molino')
          .set(asTenant(slug))
          .expect(404);

        await request(http)
          .post('/v1/cart/price')
          .set(asTenant(slug))
          .send({
            items: [{ variantId: accessory.variants[0].id, quantity: 1 }],
          })
          .expect(400);

        const quiz = await request(http)
          .post('/v1/quiz/recommend')
          .set(asTenant(slug))
          .send({});
        expect(bodyText(quiz)).not.toContain('"molino"');
      } finally {
        await prisma.tenant.delete({ where: { id: tenant.id } });
      }
    });
  });

  describe('dominios propios', () => {
    it('un dominio registrado pero sin verificar no enruta a ninguna tienda', async () => {
      const host = `${RUN}-sin-verificar.example.com`;
      await prisma.tenantDomain.create({
        data: { tenantId: a.tenantId, domain: host, verified: false },
      });
      await request(http)
        .get('/v1/tenant-domains/resolve')
        .query({ host })
        .expect(404);
    });

    it('un dominio verificado enruta solo a su tienda', async () => {
      const host = `${RUN}-verificado.example.com`;
      await prisma.tenantDomain.create({
        data: { tenantId: b.tenantId, domain: host, verified: true },
      });
      const res = await request(http)
        .get('/v1/tenant-domains/resolve')
        .query({ host })
        .expect(200);
      expect((res.body as { slug: string }).slug).toBe(slugB);
    });
  });

  describe('panel de operador', () => {
    const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

    it('el operador de A ve los pedidos de A', async () => {
      const res = await request(http)
        .get('/v1/admin/orders')
        .set(auth(a.operatorToken))
        .set(asTenant(slugA))
        .expect(200);
      expect(bodyText(res)).toContain(a.orderId);
      expect(bodyText(res)).not.toContain(b.orderId);
    });

    it.each([
      ['pedidos', '/v1/admin/orders'],
      ['productos', '/v1/admin/products'],
      ['clientes', '/v1/admin/customers'],
      ['cupones', '/v1/admin/discount-codes'],
      ['ajustes', '/v1/admin/settings'],
      ['blog', '/v1/admin/blog'],
      ['guías', '/v1/admin/brew-guides'],
      ['sedes', '/v1/admin/locations'],
      ['páginas', '/v1/admin/pages'],
    ])('el operador de A no entra a %s de B', async (_name, path) => {
      await request(http)
        .get(path)
        .set(auth(a.operatorToken))
        .set(asTenant(slugB))
        .expect(403);
    });

    it('el operador de A no puede abrir ni modificar un pedido de B por id', async () => {
      await request(http)
        .get(`/v1/admin/orders/${b.orderId}`)
        .set(auth(a.operatorToken))
        .set(asTenant(slugA))
        .expect(404);
      await request(http)
        .patch(`/v1/admin/orders/${b.orderId}`)
        .set(auth(a.operatorToken))
        .set(asTenant(slugA))
        .send({ internalNotes: 'intruso' })
        .expect(404);
      const untouched = await prisma.order.findUnique({
        where: { id: b.orderId },
        select: { internalNotes: true },
      });
      expect(untouched?.internalNotes).toBeNull();
    });

    it('el panel de contenido de A solo lista lo de A', async () => {
      for (const [path, own, other] of [
        ['/v1/admin/blog', a.blogId, b.blogId],
        ['/v1/admin/brew-guides', a.guideId, b.guideId],
        ['/v1/admin/locations', a.locationId, b.locationId],
      ]) {
        const res = await request(http)
          .get(path)
          .set(auth(a.operatorToken))
          .set(asTenant(slugA))
          .expect(200);
        expect(bodyText(res)).toContain(own);
        expect(bodyText(res)).not.toContain(other);
      }
    });

    it.each([
      ['un artículo', '/v1/admin/blog', 'blogId', { title: 'intruso' }],
      ['una guía', '/v1/admin/brew-guides', 'guideId', { title: 'intruso' }],
      ['una sede', '/v1/admin/locations', 'locationId', { name: 'intruso' }],
    ] as const)(
      'el operador de A no puede leer, editar ni borrar %s de B por id',
      async (_name, base, key, body) => {
        const id = b[key];
        for (const req of [
          request(http).get(`${base}/${id}`),
          request(http).patch(`${base}/${id}`).send(body),
          request(http).delete(`${base}/${id}`),
        ]) {
          await req.set(auth(a.operatorToken)).set(asTenant(slugA)).expect(404);
        }
      },
    );

    it('el contenido de B sigue intacto tras los intentos de A', async () => {
      const [post, guide, location] = await Promise.all([
        prisma.blogPost.findUnique({ where: { id: b.blogId } }),
        prisma.brewGuide.findUnique({ where: { id: b.guideId } }),
        prisma.storeLocation.findUnique({ where: { id: b.locationId } }),
      ]);
      expect(post?.title).toBe('Artículo privado b');
      expect(guide?.title).toBe('Guía privada b');
      expect(location?.name).toBe('Sede privada b');
    });

    it('la guía y la sede de B no se ven en la tienda pública de A', async () => {
      await request(http)
        .get(`/v1/brew-guides/${b.guideSlug}`)
        .set(asTenant(slugA))
        .expect(404);
      const res = await request(http)
        .get('/v1/locations')
        .set(asTenant(slugA))
        .expect(200);
      expect(bodyText(res)).toContain(a.locationId);
      expect(bodyText(res)).not.toContain(b.locationId);
    });

    it('las páginas editoriales de A no tocan ni se ven en B', async () => {
      const page = {
        title: 'Historia privada a',
        sections: [{ body: 'texto de a' }],
      };
      await request(http)
        .put('/v1/admin/pages/historia')
        .set(auth(a.operatorToken))
        .set(asTenant(slugA))
        .send({ content: page, active: true })
        .expect(200);
      // A no puede escribir la página de B declarando la tienda B.
      await request(http)
        .put('/v1/admin/pages/historia')
        .set(auth(a.operatorToken))
        .set(asTenant(slugB))
        .send({ content: page, active: true })
        .expect(403);

      const own = await request(http)
        .get('/v1/content/pages/historia')
        .set(asTenant(slugA))
        .expect(200);
      expect(bodyText(own)).toContain('Historia privada a');
      await request(http)
        .get('/v1/content/pages/historia')
        .set(asTenant(slugB))
        .expect(404);

      const profileB = await request(http)
        .get('/v1/tenants/current')
        .set(asTenant(slugB))
        .expect(200);
      expect(bodyText(profileB)).not.toContain('Historia privada a');
      const profileA = await request(http)
        .get('/v1/tenants/current')
        .set(asTenant(slugA))
        .expect(200);
      // El perfil público no lleva el texto, solo la bandera efectiva.
      expect(bodyText(profileA)).not.toContain('Historia privada a');
      expect(
        (profileA.body as { branding: { pages: Record<string, boolean> } })
          .branding.pages.historia,
      ).toBe(true);
    });

    it('el pedido de invitado exige el secreto interno', async () => {
      await request(http)
        .post('/v1/orders/guest')
        .set(asTenant(slugA))
        .send({
          email: 'x@example.com',
          items: [{ variantId: a.variantId, quantity: 1 }],
          shippingAddress: { line1: 'Calle 1', city: 'Bogotá', country: 'CO' },
        })
        .expect(401);
    });
  });
});
