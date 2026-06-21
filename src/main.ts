import { NestFactory } from '@nestjs/core';
import { Logger as NestLogger, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { PrismaService } from './prisma/prisma.service';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

/**
 * Resuelve el conjunto de dominios de cliente permitidos para CORS a partir de
 * la tabla TenantDomain (modelo "front a medida": cada tienda vive en su propio
 * dominio). Cacheado con TTL corto para no pegar a BD en cada preflight.
 */
function makeTenantDomainResolver(prisma: PrismaService) {
  const TTL_MS = 60_000;
  let cache = new Set<string>();
  let exp = 0;

  return async function isAllowedTenantDomain(host: string): Promise<boolean> {
    const now = Date.now();
    if (now > exp) {
      const rows = await prisma.tenantDomain.findMany({
        select: { domain: true },
      });
      cache = new Set(rows.map((r) => r.domain.toLowerCase()));
      exp = now + TTL_MS;
    }
    return cache.has(host.toLowerCase());
  };
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });

  app.useLogger(app.get(Logger));
  app.use(cookieParser());

  // El front (Vercel) y subdominios de tenant. En prod restringir por regex.
  const isProd = process.env.NODE_ENV === 'production';
  const webAppUrl = process.env.WEB_APP_URL ?? 'http://localhost:3000';
  const apexHost = new URL(webAppUrl).hostname.split('.').slice(-2).join('.');
  const apexEscaped = apexHost.replace(/\./g, '\\.');
  // Permite el apex y cualquier subdominio (multi-tenant por subdominio).
  const corsRegex = new RegExp(
    `^https?:\\/\\/([a-z0-9-]+\\.)*${apexEscaped}$`,
    'i',
  );
  // Orígenes extra (CSV) — útil para permitir localhost desde prod.
  const extraOrigins = new Set(
    (process.env.CORS_EXTRA_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

  const isAllowedTenantDomain = makeTenantDomainResolver(app.get(PrismaService));
  const corsLogger = new NestLogger('CORS');

  app.enableCors({
    // Fuera de prod: refleja cualquier origin (dev sin fricción).
    // En prod: apex/subdominios + CSV extra + dominios de cliente en TenantDomain.
    origin: !isProd
      ? true
      : (
          origin: string | undefined,
          cb: (err: Error | null, allow?: boolean) => void,
        ) => {
          // Requests sin Origin (curl, server-to-server, health checks) pasan.
          if (!origin) return cb(null, true);
          if (corsRegex.test(origin) || extraOrigins.has(origin)) {
            return cb(null, true);
          }
          let host: string;
          try {
            host = new URL(origin).hostname;
          } catch {
            return cb(null, false);
          }
          isAllowedTenantDomain(host)
            .then((allowed) => cb(null, allowed))
            .catch((err) => {
              corsLogger.error(`Fallo resolviendo dominio CORS: ${origin}`, err);
              cb(null, false);
            });
        },
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-Slug'],
    exposedHeaders: ['Set-Cookie'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());

  // OpenAPI — el front genera su SDK tipado desde /docs-json
  const config = new DocumentBuilder()
    .setTitle('BestCoffee API')
    .setDescription('API multi-tenant de la plataforma SaaS de café')
    .setVersion('1.0')
    .addBearerAuth()
    .addGlobalParameters({
      name: 'X-Tenant-Slug',
      in: 'header',
      required: false,
      description: 'Slug del tenant (lo pega el SDK del front)',
      schema: { type: 'string' },
    })
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, {
    jsonDocumentUrl: 'docs-json',
  });

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
}
void bootstrap();
