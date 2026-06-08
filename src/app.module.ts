import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ClsModule } from 'nestjs-cls';
import { LoggerModule } from 'nestjs-pino';
import configuration from './config/configuration';
import { CTX } from './common/context/request-context';
import { PrismaModule } from './prisma/prisma.module';
import { CommonModule } from './common/common.module';
import { HealthModule } from './modules/health/health.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { AuthModule } from './modules/auth/auth.module';
import { ProductsModule } from './modules/products/products.module';
import { CustomersModule } from './modules/customers/customers.module';
import { CollectionsModule } from './modules/collections/collections.module';
import { OrdersModule } from './modules/orders/orders.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { StripeModule } from './modules/stripe/stripe.module';
import { AuditModule } from './modules/audit/audit.module';
import { InngestModule } from './modules/inngest/inngest.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    // AsyncLocalStorage por request: tenantId/userId/role disponibles en servicios.
    ClsModule.forRoot({
      global: true,
      middleware: {
        mount: true,
        generateId: true,
        idGenerator: () => randomUUID(),
        setup: (cls, req) => {
          cls.set(CTX.REQUEST_ID, req.id ?? randomUUID());
        },
      },
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        transport:
          process.env.NODE_ENV !== 'production'
            ? { target: 'pino-pretty', options: { singleLine: true } }
            : undefined,
        autoLogging: true,
        redact: ['req.headers.authorization'],
      },
    }),
    PrismaModule,
    CommonModule,
    // Features
    HealthModule,
    TenantsModule,
    AuthModule,
    ProductsModule,
    CustomersModule,
    CollectionsModule,
    OrdersModule,
    SubscriptionsModule,
    StripeModule,
    AuditModule,
    InngestModule,
  ],
})
export class AppModule {}
