import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthGuard } from './guards/auth.guard';
import { CustomerAuthGuard } from './guards/customer-auth.guard';
import { TenantGuard } from './guards/tenant.guard';
import { RolesGuard } from './guards/roles.guard';
import { AuditInterceptor } from './interceptors/audit.interceptor';

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
  providers: [AuthGuard, CustomerAuthGuard, TenantGuard, RolesGuard, AuditInterceptor],
  exports: [
    JwtModule,
    AuthGuard,
    CustomerAuthGuard,
    TenantGuard,
    RolesGuard,
    AuditInterceptor,
  ],
})
export class CommonModule {}
