import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger as NestLogger, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
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
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    rawBody: true,
  });

  // Confianza en proxies inversos (Cloudflare / balanceador) para resolver la IP real del cliente
  app.set('trust proxy', 1);

  // Cabeceras de seguridad HTTP con Helmet
  app.use(
    helmet({
      contentSecurityPolicy: false, // Permitir Swagger UI sin bloquear scripts/estilos inline
      crossOriginResourcePolicy: { policy: 'cross-origin' }, // Permitir consumo cross-origin por el frontend
    }),
  );

  app.useLogger(app.get(Logger));
  app.use(cookieParser());

  // El front (Vercel) y subdominios de tenant. En prod restringir por regex.
  const isProd = process.env.NODE_ENV === 'production';
  // Fuera de prod, por defecto se refleja cualquier origin (dev sin fricción).
  // Hay que optar explícitamente por NO hacerlo con ALLOW_ANY_ORIGIN=0/false
  // en entornos no-prod que sí quieran probar la validación real de CORS
  // (p.ej. staging). Nunca se infiere "permitir cualquier origin" en
  // producción, sin importar esta variable.
  const allowAnyOriginEnv = process.env.ALLOW_ANY_ORIGIN;
  const allowAnyOrigin =
    !isProd &&
    (allowAnyOriginEnv === undefined ||
      allowAnyOriginEnv === '1' ||
      allowAnyOriginEnv.toLowerCase() === 'true');
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

  const isAllowedTenantDomain = makeTenantDomainResolver(
    app.get(PrismaService),
  );
  const corsLogger = new NestLogger('CORS');

  app.enableCors({
    // Fuera de prod: refleja cualquier origin si ALLOW_ANY_ORIGIN lo permite
    // (dev sin fricción). En prod: apex/subdominios + CSV extra + dominios
    // de cliente en TenantDomain, siempre, sin excepción.
    origin: allowAnyOrigin
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
              corsLogger.error(
                `Fallo resolviendo dominio CORS: ${origin}`,
                err,
              );
              cb(null, false);
            });
        },
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-Slug'],
    exposedHeaders: ['Set-Cookie'],
  });

  // forbidNonWhitelisted global: rechaza con 400 cualquier propiedad extra no
  // declarada en los DTOs, para detectar pronto desalineaciones de contrato
  // con el frontend (campos renombrados/eliminados que el cliente siga
  // enviando). No se pudo diferenciar de forma simple solo para /v1/admin/*
  // sin un pipe por-ruta, así que se activa globalmente.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());

  // Cierre limpio de conexiones ante SIGTERM/SIGINT en Docker/K8s
  app.enableShutdownHooks();

  // OpenAPI — el front genera su SDK tipado desde /docs-json.
  // En producción se oculta por defecto salvo que ENABLE_SWAGGER=1.
  if (!isProd || process.env.ENABLE_SWAGGER === '1') {
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
  }

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
}
void bootstrap();
