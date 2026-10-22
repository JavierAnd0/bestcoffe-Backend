import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthGuard } from './guards/auth.guard';
import { CustomerAuthGuard } from './guards/customer-auth.guard';
import { TenantGuard } from './guards/tenant.guard';
import { RolesGuard } from './guards/roles.guard';
import { AppThrottlerGuard } from './guards/app-throttler.guard';
import { AuditInterceptor } from './interceptors/audit.interceptor';
import { TurnstileService } from './services/turnstile.service';

/**
 * Infraestructura transversal: JWT global + guards/interceptors reutilizables.
 * Marcado @Global para no re-importar en cada módulo de feature.
 */
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwt.secret'),
        signOptions: {
          expiresIn: config.get<string>('jwt.expiresIn'),
        } as Record<string, unknown>,
      }),
    }),
  ],
  providers: [
    AuthGuard,
    CustomerAuthGuard,
    TenantGuard,
    RolesGuard,
    AppThrottlerGuard,
    AuditInterceptor,
    TurnstileService,
  ],
  exports: [
    JwtModule,
    AuthGuard,
    CustomerAuthGuard,
    TenantGuard,
    RolesGuard,
    AppThrottlerGuard,
    AuditInterceptor,
    TurnstileService,
  ],
})
export class CommonModule {}
