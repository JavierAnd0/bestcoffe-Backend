/**
 * Entorno de las pruebas e2e. Corren contra una base de datos de PRUEBAS, nunca
 * contra la de desarrollo o producción. Para prepararla en local:
 *
 *   createdb bestcoffee_test
 *   export E2E_DATABASE_URL=postgresql://<usuario>@localhost:5432/bestcoffee_test
 *   DATABASE_URL=$E2E_DATABASE_URL DIRECT_URL=$E2E_DATABASE_URL pnpm prisma migrate deploy
 *   pnpm test:e2e
 *
 * El entorno se fuerza aquí, antes de cargar la app, para que un `.env` local
 * que apunte a otra base no pueda colarse.
 */
const url =
  process.env.E2E_DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5432/bestcoffee_test';

if (!/test/i.test(new URL(url).pathname)) {
  throw new Error(
    `E2E_DATABASE_URL debe apuntar a una base de pruebas (su nombre debe contener "test"): ${new URL(url).pathname}`,
  );
}

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = url;
process.env.DIRECT_URL = url;
process.env.WEB_APP_URL = 'http://localhost:3000';
process.env.JWT_SECRET = 'e2e-jwt-secret-solo-para-pruebas-0123456789';
process.env.REVALIDATE_SECRET = 'e2e-revalidate-secret-0123456789';
process.env.WEB_REVALIDATE_URL = '';
process.env.STRIPE_SECRET_KEY = '';
process.env.RESEND_API_KEY = '';
process.env.TURNSTILE_SECRET_KEY = '';
process.env.INNGEST_DEV = '1';
