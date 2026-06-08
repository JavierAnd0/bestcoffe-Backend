import 'dotenv/config';
import path from 'node:path';
import { defineConfig } from 'prisma/config';

// Prisma 7: la config de schema, migraciones y seed vive aquí (ya no en el
// bloque datasource). El runtime usa driver adapters (ver PrismaService).
export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    // Conexión directa (no pooled) para migrate/seed.
    seed: 'node --import tsx prisma/seed.ts',
  },
  // URL usada por la CLI (migrate/db push). En runtime se usa el adapter.
  datasource: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
  },
});
