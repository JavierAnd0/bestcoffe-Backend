/**
 * Prepara la tienda `demo` que se muestra a las cafeterías: un tenant marcado
 * como SANDBOX (cada visitante enciende y apaga sus funciones sin afectar a
 * nadie más) y con contenido de ejemplo para que cada función se vea.
 *
 *   node --import tsx scripts/seed-demo-tenant.ts
 *
 * Es idempotente. La demo nunca cobra: el backend fuerza `onlinePayments` apagado
 * en una tienda sandbox. Nunca ejecutar contra producción con datos reales.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

if (process.env.NODE_ENV === 'production') {
  console.error('Rechazado: NODE_ENV=production');
  process.exit(1);
}

const SLUG = 'demo';
const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
  }),
});
const COP = (pesos: number) => pesos * 100;

const COFFEES = [
  {
    slug: 'casa-clasico',
    name: 'Clásico de la Casa',
    type: 'BLEND',
    origin: 'Huila, Colombia',
    roast: 5,
    notes: ['caramelo', 'nuez'],
    price: 32000,
  },
  {
    slug: 'finca-altura',
    name: 'Finca de Altura',
    type: 'SINGLE_ORIGIN',
    origin: 'Nariño, Colombia',
    roast: 4,
    notes: ['frutos rojos', 'panela'],
    price: 38000,
  },
  {
    slug: 'espresso-noche',
    name: 'Espresso de Noche',
    type: 'BLEND',
    origin: 'Cauca, Colombia',
    roast: 8,
    notes: ['chocolate amargo', 'tostado'],
    price: 34000,
  },
  {
    slug: 'suave-sin-cafeina',
    name: 'Suave sin Cafeína',
    type: 'DECAF',
    origin: 'Tolima, Colombia',
    roast: 5,
    notes: ['vainilla', 'almendra'],
    price: 36000,
  },
] as const;

const ACCESSORIES = [
  { slug: 'molino-manual', name: 'Molino Manual', price: 189000 },
  {
    slug: 'tetera-cuello-cisne',
    name: 'Tetera Cuello de Cisne',
    price: 165000,
  },
] as const;

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { slug: SLUG },
    update: {
      name: 'Cafetería Demo',
      tier: 'BUSINESS',
      features: { demoSandbox: true },
      branding: {
        tagline: 'Tu cafetería, en línea',
        accent: '#2f6f5e',
        hero: 'classic',
        city: 'Bogotá',
        contactEmail: 'demo@example.com',
      },
    },
    create: {
      slug: SLUG,
      name: 'Cafetería Demo',
      tier: 'BUSINESS',
      features: { demoSandbox: true },
      branding: {
        tagline: 'Tu cafetería, en línea',
        accent: '#2f6f5e',
        hero: 'classic',
        city: 'Bogotá',
        contactEmail: 'demo@example.com',
      },
    },
  });

  const owner = await prisma.user.upsert({
    where: { email: `dueno@${SLUG}.test` },
    update: {},
    create: { email: `dueno@${SLUG}.test`, name: 'Dueño Demo' },
  });
  await prisma.tenantMembership.upsert({
    where: { userId_tenantId: { userId: owner.id, tenantId: tenant.id } },
    update: {},
    create: { userId: owner.id, tenantId: tenant.id, role: 'TENANT_OWNER' },
  });

  for (const c of COFFEES) {
    const existing = await prisma.product.findUnique({
      where: { tenantId_slug: { tenantId: tenant.id, slug: c.slug } },
      select: { id: true },
    });
    if (existing) continue;
    await prisma.product.create({
      data: {
        tenantId: tenant.id,
        slug: c.slug,
        name: c.name,
        type: c.type,
        origin: c.origin,
        roastLevel: c.roast,
        flavorNotes: [...c.notes],
        badges: [],
        status: 'ACTIVE',
        subscriptionAvailability: 'YES',
        description: `${c.name}: café de especialidad tostado en lotes pequeños.`,
        variants: {
          create: [250, 500].map((g) => ({
            tenantId: tenant.id,
            sizeGrams: g,
            grind: 'WHOLE_BEAN' as const,
            priceOneTime: COP(g === 250 ? c.price : c.price * 1.8),
            priceSubscription: COP(
              Math.round((g === 250 ? c.price : c.price * 1.8) * 0.9),
            ),
            stock: 40,
          })),
        },
      },
    });
  }

  for (const a of ACCESSORIES) {
    const existing = await prisma.product.findUnique({
      where: { tenantId_slug: { tenantId: tenant.id, slug: a.slug } },
      select: { id: true },
    });
    if (existing) continue;
    await prisma.product.create({
      data: {
        tenantId: tenant.id,
        slug: a.slug,
        name: a.name,
        type: 'ACCESSORY',
        roastLevel: 0,
        flavorNotes: [],
        badges: [],
        status: 'ACTIVE',
        subscriptionAvailability: 'NO',
        description: `${a.name} para preparar café en casa.`,
        variants: {
          create: {
            tenantId: tenant.id,
            sizeGrams: 1,
            grind: 'WHOLE_BEAN',
            priceOneTime: COP(a.price),
            priceSubscription: null,
            stock: 15,
          },
        },
      },
    });
  }

  for (const [slug, title, excerpt] of [
    [
      'como-elegir-tu-cafe',
      'Cómo elegir tu café',
      'Origen, tueste y notas: una guía rápida para comprar bien.',
    ],
    [
      'metodos-de-preparacion',
      'Métodos de preparación en casa',
      'V60, prensa francesa y moka: qué esperar de cada una.',
    ],
  ] as const) {
    await prisma.blogPost.upsert({
      where: { tenantId_slug: { tenantId: tenant.id, slug } },
      update: {},
      create: {
        tenantId: tenant.id,
        slug,
        title,
        excerpt,
        body: `${excerpt}\n\nArtículo de ejemplo de la tienda demo.`,
        publishedAt: new Date('2026-10-01T12:00:00Z'),
      },
    });
  }

  await prisma.discountCode.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: 'DEMO10' } },
    update: {},
    create: {
      tenantId: tenant.id,
      code: 'DEMO10',
      type: 'PERCENTAGE',
      value: 10,
    },
  });

  const products = await prisma.product.count({
    where: { tenantId: tenant.id },
  });
  console.log(
    `Tienda demo lista: ${tenant.slug} · ${products} productos · sandbox activado`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
