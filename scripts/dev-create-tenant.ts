/**
 * Crea una tienda de prueba VACÍA (como la dejaría el alta de un cliente nuevo)
 * para comprobar el aislamiento entre tenants en desarrollo.
 *
 *   node --import tsx scripts/dev-create-tenant.ts <slug> "<Nombre>"
 *
 * Es idempotente. Nunca ejecutar contra producción.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const [slug, name] = process.argv.slice(2);
if (!slug || !name) {
  console.error('Uso: dev-create-tenant.ts <slug> "<Nombre>"');
  process.exit(1);
}
if (process.env.NODE_ENV === 'production') {
  console.error('Rechazado: NODE_ENV=production');
  process.exit(1);
}

const adapter = new PrismaPg({
  connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
});
const prisma = new PrismaClient({ adapter });

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { slug },
    update: {},
    create: { slug, name, tier: 'PRO', features: {}, branding: {} },
  });
  const owner = await prisma.user.upsert({
    where: { email: `dueno@${slug}.test` },
    update: {},
    create: { email: `dueno@${slug}.test`, name: `Dueño ${name}` },
  });
  await prisma.tenantMembership.upsert({
    where: { userId_tenantId: { userId: owner.id, tenantId: tenant.id } },
    update: {},
    create: { userId: owner.id, tenantId: tenant.id, role: 'TENANT_OWNER' },
  });
  console.log(`Tenant listo: ${tenant.slug} (${tenant.id})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
