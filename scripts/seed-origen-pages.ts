/**
 * Pasa a datos las páginas editoriales de la tienda `origen` (historia,
 * impacto, sostenibilidad, mayoristas), que antes estaban escritas en el código
 * del front. Desde ahora cada tienda las escribe en su panel (Contenido →
 * Páginas) y se guardan en `Tenant.branding.editorialPages`; la activación es
 * `Tenant.branding.pages` (la misma clave que usa el superadmin).
 *
 *   DATABASE_URL=… DIRECT_URL=… node --import tsx scripts/seed-origen-pages.ts
 *
 * Idempotente y seguro de correr en producción: solo escribe las páginas que la
 * tienda aún no tiene (nunca pisa lo que haya editado en el panel) y solo
 * activa las que no tengan una bandera guardada. `--force` reescribe el
 * contenido de las cuatro páginas con el de este archivo.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '@prisma/client';

const SLUG = 'origen';
const FORCE = process.argv.includes('--force');

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
  }),
});

const PAGES: Record<string, Record<string, unknown>> = {
  historia: {
    eyebrow: 'Desde 2018',
    title: 'Nuestra historia',
    intro:
      'De una pequeña bodega con tostador de 5 kilos en Chapinero a más de 40 familias caficultoras aliadas en toda Colombia.',
    imageUrl: '/img/taza-granos.jpg',
    imageAlt: 'Café de especialidad en grano y taza',
    sections: [
      {
        body: 'ORÍGEN nació en una bodega pequeña de Chapinero con un solo tostador de 5 kilos y la idea fija de que el café colombiano de alta calidad debía quedarse en Colombia.\n\nEmpezamos comprándole a tres familias en Huila y Nariño. Hoy trabajamos con más de 40 fincas y mantenemos relación directa con cada productora y productor. Pagamos en promedio 60% por encima del precio C de bolsa según el lote y el resultado de la cata.',
        imageUrl: '/img/bulto-colombia.jpg',
        imageAlt: 'Saco de café Product of Colombia',
      },
      {
        body: 'Creemos en tostar pequeño y enviar fresco. Cada bolsa que sale de nuestra tostadora salió del tostador hace menos de cinco días. La fecha de tueste está impresa en cada empaque.',
      },
      {
        title: 'Lo que defendemos',
        body: [
          '- **Calidad sobre escala.** Lotes pequeños, cata previa al tueste y QC en cada despacho.',
          '- **Relación directa.** Conocemos a quien cultiva nuestro café. Sin intermediarios.',
          '- **Precios justos.** Tanto al productor como al consumidor. Sin marcas de lujo artificiales.',
          '- **Frescura.** Tostado bajo pedido. Enviado en máximo 48 horas desde el tueste.',
        ].join('\n'),
      },
    ],
  },
  impacto: {
    eyebrow: 'Impacto y Comercio Justo',
    title: 'Café que cuida',
    intro:
      'Nuestra cadena es lo más corta posible: del productor al tostador, del tostador a tu taza.',
    imageUrl: '/img/sacos-cafe-verde.jpg',
    imageAlt: 'Sacos de café arábica lavado en origen',
    highlights: [
      { value: '+40', label: 'Familias productoras con relación directa' },
      { value: '60%', label: 'Sobreprecio promedio sobre la bolsa C' },
      { value: '100%', label: 'Empaque reciclable o compostable' },
      { value: '2 t', label: 'Café tostado por mes en lotes pequeños' },
    ],
    sections: [
      {
        title: 'Relación directa, no comercio justo certificado',
        body: 'En vez de pagar por un sello, vamos a las fincas, catamos cada lote y negociamos un precio acorde con su calidad. Esto significa pagos por encima del precio internacional, transparencia total en la cadena y relaciones que duran años.',
      },
      {
        title: 'Empaque consciente',
        body: 'Nuestras bolsas son de papel kraft con barrera compostable y válvula unidireccional para preservar la frescura. Si lo prefieres, pide tu café en frasco retornable cuando visites una de nuestras tiendas.',
      },
    ],
  },
  sostenibilidad: {
    eyebrow: 'Planeta & Comunidad',
    title: 'Sostenibilidad desde la raíz',
    intro:
      'Para nosotros, la sostenibilidad no es una etiqueta publicitaria: es el modelo económico y ético que permite que el mejor café colombiano siga existiendo para las próximas generaciones.',
    imageUrl: '/img/bulto-colombia.jpg',
    imageAlt: 'Saco de café Product of Colombia',
    imageCaption:
      '100% Café de origen colombiano con trazabilidad directa desde la finca',
    highlights: [
      { value: '+40', label: 'Familias caficultoras asociadas' },
      { value: '60%', label: 'Sobreprecio promedio sobre bolsa C' },
      { value: '100%', label: 'Empaques reciclables o compostables' },
      { value: '0', label: 'Intermediarios en la compra de café verde' },
    ],
    sectionsEyebrow: 'Nuestros Pilares',
    sectionsTitle: 'Acciones reales en cada eslabón',
    sections: [
      {
        title: 'Comercio Directo y Transparente',
        body: 'Pagamos en promedio un 60% por encima del precio internacional C de bolsa. Compramos de manera directa sin intermediarios comerciales que diluyan el valor para el caficultor.',
      },
      {
        title: 'Caficultura Regenerativa',
        body: 'Apoyamos fincas que aplican sombra natural, rotación de cultivos y protección de cuencas hídricas locales, promoviendo la biodiversidad en las regiones de origen.',
      },
      {
        title: 'Empaque Consciente',
        body: 'Nuestras bolsas están fabricadas con papel kraft certificado y barreras biodegradables. Además fomentamos el uso de recipientes retornables en nuestras tiendas físicas.',
      },
      {
        title: 'Tostado Eficiente en Lotes Pequeños',
        body: 'Nuestra curva de tueste optimizada minimiza la emisión de calor y desperdicio de energía, tostando bajo demanda semanal para evitar mermas de producto.',
      },
    ],
    cta: {
      title: 'Conoce el impacto de tu compra',
      body: 'Cada bolsa de café tiene un código de trazabilidad donde puedes consultar el nombre del productor, la vereda, la altitud y el proceso de fermentación de cada lote.',
      label: 'Explorar cafés sostenibles',
      href: '/catalogo',
      secondaryLabel: 'Ver reporte de impacto',
      secondaryHref: '/impacto',
    },
  },
  mayoristas: {
    eyebrow: 'Mayoristas · B2B',
    title: 'Café para tu negocio',
    intro:
      'Trabajamos con cafeterías, restaurantes, hoteles y oficinas. Cuéntanos de tu operación y te respondemos en menos de 48 horas.',
    imageUrl: '/img/sacos-cafe-verde.jpg',
    imageAlt: 'Sacos de café verde para mayoristas',
    imageCaption:
      'Suministro de microlotes y mezclas personalizadas para hostelería y empresas',
    sections: [
      {
        title: 'Precios por volumen',
        body: 'Tarifa diferenciada con escalas según el volumen mensual contratado.',
      },
      {
        title: 'Capacitación incluida',
        body: 'Entrenamiento básico de barismo para tu equipo y soporte en montaje.',
      },
      {
        title: 'Recetas y perfiles',
        body: 'Trabajamos contigo el perfil de tueste y la receta para tu equipo.',
      },
      {
        title: 'Envíos programados',
        body: 'Logística semanal o quincenal según tu rotación y bodega.',
      },
    ],
    // Sin correo ni teléfono propios: la página usa los de contacto de la tienda.
    cta: {
      title: 'Cuéntanos de tu negocio',
      body: 'Escríbenos con el tipo de negocio, el volumen mensual estimado y la ciudad, y te respondemos en menos de 48 horas.',
    },
  },
};

type Json = Record<string, unknown>;
const asObject = (v: unknown): Json =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {};

async function main() {
  const tenant = await prisma.tenant.findUnique({
    where: { slug: SLUG },
    select: { id: true, branding: true },
  });
  if (!tenant) {
    console.error(`No existe la tienda "${SLUG}"`);
    process.exitCode = 1;
    return;
  }

  const branding = asObject(tenant.branding);
  const editorial = { ...asObject(branding.editorialPages) };
  const pages = { ...asObject(branding.pages) };
  const now = new Date().toISOString();
  const written: string[] = [];
  const activated: string[] = [];

  for (const [slug, content] of Object.entries(PAGES)) {
    const current = asObject(editorial[slug]);
    if (FORCE || typeof current.title !== 'string' || !current.title) {
      editorial[slug] = { ...content, updatedAt: now };
      written.push(slug);
    }
    // Antes estas páginas estaban activas por defecto en esta tienda: se
    // conserva, salvo que alguien ya haya guardado una decisión.
    if (typeof pages[slug] !== 'boolean') {
      pages[slug] = true;
      activated.push(slug);
    }
  }
  if (typeof pages.tiendas !== 'boolean') {
    pages.tiendas = true;
    activated.push('tiendas');
  }

  if (!written.length && !activated.length) {
    console.log('Nada que hacer: la tienda ya tiene sus páginas.');
    return;
  }

  await prisma.tenant.update({
    where: { id: tenant.id },
    data: {
      branding: {
        ...branding,
        editorialPages: editorial,
        pages,
      } as Prisma.InputJsonValue,
    },
  });
  console.log(
    `Páginas escritas: ${written.join(', ') || 'ninguna'} · activadas: ${activated.join(', ') || 'ninguna'}`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
