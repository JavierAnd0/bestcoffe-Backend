import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.useLogger(app.get(Logger));

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

  app.enableCors({
    origin: isProd ? [corsRegex] : true,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-Slug'],
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
