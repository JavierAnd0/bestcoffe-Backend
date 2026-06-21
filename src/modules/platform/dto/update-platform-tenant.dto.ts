import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsISO8601,
  IsObject,
  IsOptional,
} from 'class-validator';
import {
  Tier,
  TenantBillingType,
  TenantBillingStatus,
  TenantBillingCycle,
} from '@prisma/client';

export class UpdatePlatformTenantDto {
  @ApiPropertyOptional({ enum: Tier })
  @IsOptional()
  @IsIn(Object.values(Tier))
  tier?: Tier;

  @ApiPropertyOptional({ description: 'Feature flags (merge con los existentes)' })
  @IsOptional()
  @IsObject()
  features?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Datos de branding (merge con los existentes)' })
  @IsOptional()
  @IsObject()
  branding?: Record<string, unknown>;

  // ── Facturación (gestión manual) ──────────────────────────────────────────
  @ApiPropertyOptional({ enum: TenantBillingType })
  @IsOptional()
  @IsIn(Object.values(TenantBillingType))
  billingType?: TenantBillingType;

  @ApiPropertyOptional({ enum: TenantBillingStatus })
  @IsOptional()
  @IsIn(Object.values(TenantBillingStatus))
  billingStatus?: TenantBillingStatus;

  @ApiPropertyOptional({ enum: TenantBillingCycle, nullable: true })
  @IsOptional()
  @IsIn([...Object.values(TenantBillingCycle), null])
  billingCycle?: TenantBillingCycle | null;

  @ApiPropertyOptional({ description: 'ISO date — inicio de suscripción o pago único', nullable: true })
  @IsOptional()
  @IsISO8601()
  billingStartedAt?: string | null;

  @ApiPropertyOptional({ description: 'ISO date — próxima renovación o fin de mantenimiento', nullable: true })
  @IsOptional()
  @IsISO8601()
  currentPeriodEnd?: string | null;

  @ApiPropertyOptional({ description: 'ISO date — cancelación', nullable: true })
  @IsOptional()
  @IsISO8601()
  cancelledAt?: string | null;
}
