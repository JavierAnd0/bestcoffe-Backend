import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthGuard } from './guards/auth.guard';
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
          // env es string; el tipo de `ms` (StringValue) exige relajar el tipo.
          expiresIn: config.get<string>('jwt.expiresIn'),
        } as Record<string, unknown>,
      }),
    }),
  ],
  providers: [AuthGuard, TenantGuard, RolesGuard, AuditInterceptor],
  exports: [
    JwtModule,
    AuthGuard,
    TenantGuard,
    RolesGuard,
    AuditInterceptor,
  ],
})
export class CommonModule {}
