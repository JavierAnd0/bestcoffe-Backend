import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ClsModule } from 'nestjs-cls';
import { LoggerModule } from 'nestjs-pino';
import configuration from './config/configuration';
import { CTX } from './common/context/request-context';
import { PrismaModule } from './prisma/prisma.module';
import { CommonModule } from './common/common.module';
import { RevalidationModule } from './modules/revalidation/revalidation.module';
import { HealthModule } from './modules/health/health.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { AuthModule } from './modules/auth/auth.module';
import { ProductsModule } from './modules/products/products.module';
import { CollectionsModule } from './modules/collections/collections.module';
import { ContentModule } from './modules/content/content.module';
import { BlogModule } from './modules/blog/blog.module';
import { QuizModule } from './modules/quiz/quiz.module';
import { CartModule } from './modules/cart/cart.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { CustomersModule } from './modules/customers/customers.module';
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
    RevalidationModule,
    // Features
    HealthModule,
    TenantsModule,
    AuthModule,
    ProductsModule,
    CollectionsModule,
    ContentModule,
    BlogModule,
    QuizModule,
    CartModule,
    ReviewsModule,
    CustomersModule,
    OrdersModule,
    SubscriptionsModule,
    StripeModule,
    AuditModule,
    InngestModule,
  ],
})
export class AppModule {}
