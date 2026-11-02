import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  GrindFormat,
  PrismaClient,
  ProductStatus,
  ProductType,
  SubAvail,
  SubStatus,
} from '@prisma/client';

const adapter = new PrismaPg({
  connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
});
const prisma = new PrismaClient({ adapter });

// COP en centavos (x100). 45.000 COP = 4_500_000
const COP = (pesos: number) => pesos * 100;

async function main() {
  console.log('🌱 Seeding tenant ORÍGEN…');

  const tenant = await prisma.tenant.upsert({
    where: { slug: 'origen' },
    update: {},
    create: {
      slug: 'origen',
      name: 'ORÍGEN',
      tier: 'PRO',
      features: {
        maxProducts: 200,
        customDomain: false,
        giftSubscriptions: true,
      },
      branding: {
        primary: '#3B2A1F',
        accent: '#C8642E',
        font: 'editorial',
      },
    },
  });

  // Operador dueño del tenant
  const owner = await prisma.user.upsert({
    where: { email: 'operador@origen.co' },
    update: {},
    create: { email: 'operador@origen.co', name: 'Operador ORÍGEN' },
  });
  await prisma.tenantMembership.upsert({
    where: { userId_tenantId: { userId: owner.id, tenantId: tenant.id } },
    update: { role: 'TENANT_OWNER' },
    create: { userId: owner.id, tenantId: tenant.id, role: 'TENANT_OWNER' },
  });

  // Operador real para pruebas (recibe magic link en su bandeja)
  const javier = await prisma.user.upsert({
    where: { email: 'logijavier@gmail.com' },
    update: {},
    create: { email: 'logijavier@gmail.com', name: 'Javier' },
  });
  await prisma.tenantMembership.upsert({
    where: { userId_tenantId: { userId: javier.id, tenantId: tenant.id } },
    update: { role: 'TENANT_OWNER' },
    create: { userId: javier.id, tenantId: tenant.id, role: 'TENANT_OWNER' },
  });

  // ── Productos ───────────────────────────────────────────────────────────
  const productsSeed = [
    {
      slug: 'huila-supremo',
      name: 'Huila Supremo',
      type: ProductType.SINGLE_ORIGIN,
      origin: 'Huila, Colombia',
      roastLevel: 4,
      flavorNotes: ['panela', 'cereza', 'chocolate'],
      badges: ['Más vendido'],
      producerStory: 'Finca La Esperanza, familia Ramírez, 1.750 msnm.',
    },
    {
      slug: 'narino-altura',
      name: 'Nariño Altura',
      type: ProductType.SINGLE_ORIGIN,
      origin: 'Nariño, Colombia',
      roastLevel: 3,
      flavorNotes: ['cítricos', 'floral', 'caramelo'],
      badges: ['Edición limitada'],
    },
    {
      slug: 'blend-casa',
      name: 'Blend de la Casa',
      type: ProductType.BLEND,
      origin: null,
      roastLevel: 6,
      flavorNotes: ['nuez', 'cacao', 'caramelo'],
      badges: [],
    },
    {
      slug: 'espresso-intenso',
      name: 'Espresso Intenso',
      type: ProductType.BLEND,
      origin: null,
      roastLevel: 8,
      flavorNotes: ['chocolate amargo', 'tostado', 'especias'],
      badges: ['Para espresso'],
    },
    {
      slug: 'descafeinado-suave',
      name: 'Descafeinado Suave',
      type: ProductType.DECAF,
      origin: 'Cauca, Colombia',
      roastLevel: 5,
      flavorNotes: ['vainilla', 'almendra'],
      badges: ['Sin cafeína'],
    },
    {
      slug: 'sierra-nevada',
      name: 'Sierra Nevada',
      type: ProductType.SINGLE_ORIGIN,
      origin: 'Magdalena, Colombia',
      roastLevel: 5,
      flavorNotes: ['miel', 'frutos rojos', 'cacao'],
      badges: ['Comercio justo'],
    },
  ];

  const createdProducts = [];
  for (const p of productsSeed) {
    const product = await prisma.product.upsert({
      where: { tenantId_slug: { tenantId: tenant.id, slug: p.slug } },
      update: {},
      create: {
        tenantId: tenant.id,
        slug: p.slug,
        name: p.name,
        type: p.type,
        origin: p.origin,
        roastLevel: p.roastLevel,
        flavorNotes: p.flavorNotes,
        badges: p.badges,
        producerStory: p.producerStory ?? null,
        status: ProductStatus.ACTIVE,
        subscriptionAvailability: SubAvail.YES,
        description: `Café ${p.name} de especialidad, tueste ${p.roastLevel}/9.`,
        images: {
          create: [
            {
              tenantId: tenant.id,
              url: `https://picsum.photos/seed/${p.slug}/800/800`,
              alt: p.name,
              position: 0,
            },
          ],
        },
        variants: {
          create: [
            {
              tenantId: tenant.id,
              sizeGrams: 250,
              grind: GrindFormat.WHOLE_BEAN,
              priceOneTime: COP(32000),
              priceSubscription: COP(28800),
              stock: 50,
            },
            {
              tenantId: tenant.id,
              sizeGrams: 500,
              grind: GrindFormat.WHOLE_BEAN,
              priceOneTime: COP(58000),
              priceSubscription: COP(52200),
              stock: 30,
            },
          ],
        },
      },
      include: { variants: true },
    });
    createdProducts.push(product);
  }


  // ── Accesorios y equipos de barismo (datos reales de la demo, comprables) ──
  const accessoriesSeed = [
    {
      slug: "molino-manual-precision",
      name: "Molino Manual Conical Burr",
      origin: "Equipo de precisión",
      description: "Diseñado para los entusiastas del café que buscan una molienda perfectamente homogénea en casa o de viaje. Su doble rodamiento estabiliza el eje central eliminando la fricción y el polvo excesivo.",
      details: ["Acero inox 40mm", "36 clics de ajuste", "Cuerpo aluminio"],
      badges: ["DESTACADO"],
      image: "/img/products/molino-1.jpg",
      sizeGrams: 450,
      price: 280000,
      stock: 15,
      collections: ["accesorios", "molinos", "bestsellers"],
    },
    {
      slug: "tetera-cuello-cisne",
      name: "Tetera Cuello de Cisne Gooseneck",
      origin: "Vertido de precisión",
      description: "Control absoluto de la tasa de vertido y turbulencia en tus preparaciones de V60, Chemex o Kalita. El termómetro incorporado te permite verter exactamente en la temperatura óptima de extracción (90°–93°C).",
      details: ["1.0 Litro", "Acero 304", "Termómetro integrado"],
      badges: ["BARISMO"],
      image: "/img/products/tetera-1.jpg",
      sizeGrams: 550,
      price: 165000,
      stock: 20,
      collections: ["accesorios", "teteras"],
    },
    {
      slug: "taza-ceramica-artesanal",
      name: "Taza Cerámica Artesanal 250 ml",
      origin: "Artesanal · Colombia",
      description: "Moldeada a torno y horneada a 1.240°C para una durabilidad excepcional. Su diseño orgánico se adapta cómodamente a las manos, ideal para capuchino, flat white o tu taza matutina de café filtrado.",
      details: ["250 ml", "Cerámica gres", "Hecha a mano"],
      badges: ["ARTESANAL"],
      image: "/img/products/taza-1.jpg",
      sizeGrams: 280,
      price: 42000,
      stock: 40,
      collections: ["accesorios", "tazas"],
    },
    {
      slug: "gotero-ceramico-v60",
      name: "Gotero Cerámico V60 de Extracción",
      origin: "Métodos manuales",
      description: "El método favorito de baristas profesionales alrededor del mundo. Su ángulo de 60 grados y orificio central amplio te dan el control total de la velocidad del flujo de extracción.",
      details: ["Tamaño 02", "Cerámica esmaltada", "1-4 Tazas"],
      badges: ["MÉTODOS"],
      image: "/img/products/v60-1.jpg",
      sizeGrams: 320,
      price: 78000,
      stock: 25,
      collections: ["accesorios", "metodos"],
    },
    {
      slug: "bascula-digital-barista",
      name: "Báscula Digital con Temporizador",
      origin: "Herramienta de precisión",
      description: "Báscula compacta con almohadilla de silicona antideslizante resistente al calor y pantalla LED retroiluminada de alta visibilidad. Batería recargable vía USB-C.",
      details: ["0.1 g precisión", "Cronómetro", "USB-C"],
      badges: ["PRECISIÓN"],
      image: "/img/products/bascula-1.jpg",
      sizeGrams: 300,
      price: 125000,
      stock: 18,
      collections: ["accesorios"],
    },
  ];

  const accessoryCollections: Record<string, string> = {
    accesorios: 'Accesorios y Equipos',
    molinos: 'Molinos',
    teteras: 'Teteras',
    tazas: 'Tazas',
    metodos: 'Métodos de preparación',
  };
  const collectionIds: Record<string, string> = {};
  let collectionPos = 10;
  for (const [slug, name] of Object.entries(accessoryCollections)) {
    const c = await prisma.collection.upsert({
      where: { tenantId_slug: { tenantId: tenant.id, slug } },
      update: {},
      create: { tenantId: tenant.id, slug, name, type: 'MANUAL', position: collectionPos++ },
    });
    collectionIds[slug] = c.id;
  }

  for (const a of accessoriesSeed) {
    const product = await prisma.product.upsert({
      where: { tenantId_slug: { tenantId: tenant.id, slug: a.slug } },
      update: {},
      create: {
        tenantId: tenant.id,
        slug: a.slug,
        name: a.name,
        type: ProductType.ACCESSORY,
        origin: a.origin,
        roastLevel: 0,
        flavorNotes: a.details,
        badges: a.badges,
        status: ProductStatus.ACTIVE,
        subscriptionAvailability: SubAvail.NO,
        description: a.description,
        images: {
          create: [
            { tenantId: tenant.id, url: a.image, alt: a.name, position: 0 },
          ],
        },
        variants: {
          create: [
            {
              tenantId: tenant.id,
              sizeGrams: a.sizeGrams,
              grind: GrindFormat.WHOLE_BEAN,
              priceOneTime: COP(a.price),
              priceSubscription: null,
              stock: a.stock,
            },
          ],
        },
      },
    });
    for (const cs of a.collections) {
      const collectionId = collectionIds[cs];
      if (!collectionId) continue; // p.ej. "bestsellers" vive en Más Vendidos
      await prisma.collectionProduct.upsert({
        where: { collectionId_productId: { collectionId, productId: product.id } },
        update: {},
        create: { collectionId, productId: product.id, position: 0 },
      });
    }
  }

  // ── Colecciones ──────────────────────────────────────────────────────────
  await prisma.collection.upsert({
    where: { tenantId_slug: { tenantId: tenant.id, slug: 'origenes-unicos' } },
    update: {},
    create: {
      tenantId: tenant.id,
      slug: 'origenes-unicos',
      name: 'Orígenes Únicos',
      description: 'Cafés de finca, lote y altura.',
      type: 'AUTO',
      rules: { type: 'SINGLE_ORIGIN' },
      position: 0,
    },
  });

  const masVendidos = await prisma.collection.upsert({
    where: { tenantId_slug: { tenantId: tenant.id, slug: 'mas-vendidos' } },
    update: {},
    create: {
      tenantId: tenant.id,
      slug: 'mas-vendidos',
      name: 'Más Vendidos',
      description: 'Los favoritos de nuestra comunidad.',
      type: 'MANUAL',
      position: 1,
    },
  });
  // vincular 3 productos manualmente
  for (let i = 0; i < 3; i++) {
    await prisma.collectionProduct.upsert({
      where: {
        collectionId_productId: {
          collectionId: masVendidos.id,
          productId: createdProducts[i].id,
        },
      },
      update: {},
      create: {
        collectionId: masVendidos.id,
        productId: createdProducts[i].id,
        position: i,
      },
    });
  }

  // ── Cliente demo + suscripción activa ─────────────────────────────────────
  const customer = await prisma.customer.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'cliente@demo.co' } },
    update: {},
    create: {
      tenantId: tenant.id,
      email: 'cliente@demo.co',
      name: 'Cliente Demo',
      addresses: {
        create: [
          {
            tenantId: tenant.id,
            label: 'Casa',
            line1: 'Calle 123 #45-67',
            city: 'Bogotá',
            state: 'Cundinamarca',
            country: 'CO',
            isDefault: true,
          },
        ],
      },
    },
  });

  const firstVariant = createdProducts[0].variants[0];
  const existingSub = await prisma.subscription.findFirst({
    where: { customerId: customer.id, variantId: firstVariant.id },
  });
  if (!existingSub) {
    const next = new Date();
    next.setDate(next.getDate() + 30);
    await prisma.subscription.create({
      data: {
        tenantId: tenant.id,
        customerId: customer.id,
        variantId: firstVariant.id,
        frequencyDays: 30,
        status: SubStatus.ACTIVE,
        nextShipAt: next,
        discountPct: 10,
      },
    });
  }

  // ── Contenido del storefront (Home A) ─────────────────────────────────────
  const contentSeed = [
    {
      kind: 'ANNOUNCEMENT' as const,
      position: 0,
      data: { text: 'Envío gratis en compras sobre $150.000', cta: null },
    },
    {
      kind: 'ANNOUNCEMENT' as const,
      position: 1,
      data: { text: 'Suscríbete y ahorra 10% en cada entrega', cta: { label: 'Ver planes', href: '/suscripciones' } },
    },
    {
      kind: 'HERO' as const,
      position: 0,
      data: {
        title: 'Café de origen, tostado fresco',
        subtitle: 'Directo de fincas colombianas a tu taza',
        cta: { label: 'Explorar catálogo', href: '/catalogo' },
        imageDesktop: 'https://picsum.photos/seed/hero-desktop/1600/900',
        imageMobile: 'https://picsum.photos/seed/hero-mobile/800/1000',
      },
    },
    {
      kind: 'SPOTLIGHT' as const,
      position: 0,
      data: { productSlug: 'huila-supremo', title: 'Producto del mes' },
    },
    {
      kind: 'FEATURED_BUNDLE' as const,
      position: 0,
      data: { title: 'Trío Descubrimiento', productSlugs: ['huila-supremo', 'narino-altura', 'sierra-nevada'] },
    },
  ];
  // limpiamos contenido previo del tenant para mantener el seed idempotente
  await prisma.siteContent.deleteMany({ where: { tenantId: tenant.id } });
  for (const c of contentSeed) {
    await prisma.siteContent.create({
      data: { tenantId: tenant.id, kind: c.kind, data: c.data, position: c.position, active: true },
    });
  }

  // ── Blog ──────────────────────────────────────────────────────────────────
  await prisma.blogPost.upsert({
    where: { tenantId_slug: { tenantId: tenant.id, slug: 'como-preparar-v60' } },
    update: {},
    create: {
      tenantId: tenant.id,
      slug: 'como-preparar-v60',
      title: 'Cómo preparar un V60 perfecto',
      excerpt: 'La guía paso a paso para un filtrado limpio y dulce.',
      body: 'Calienta el agua a 92–94°C, usa una proporción 1:16…',
      coverUrl: 'https://picsum.photos/seed/v60/1200/630',
      publishedAt: new Date(),
    },
  });

  // ── Código de descuento ───────────────────────────────────────────────────
  await prisma.discountCode.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: 'BIENVENIDO10' } },
    update: {},
    create: {
      tenantId: tenant.id,
      code: 'BIENVENIDO10',
      type: 'PERCENTAGE',
      value: 10,
      active: true,
    },
  });

  // Newsletter de la tienda demo: invitación discreta + cupón de bienvenida real.
  // (Idempotente: se aplica también a bases ya sembradas.)
  await prisma.tenant.update({
    where: { id: tenant.id },
    data: {
      features: {
        ...((tenant.features as Record<string, unknown>) ?? {}),
        newsletter: { popupEnabled: true, welcomeCode: 'BIENVENIDO10' },
      },
    },
  });

  console.log(`✅ Seed completo: tenant=${tenant.slug}, productos=${createdProducts.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
