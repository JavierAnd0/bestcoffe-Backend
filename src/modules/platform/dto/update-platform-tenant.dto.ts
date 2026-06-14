import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsObject, IsOptional } from 'class-validator';
import { Tier } from '@prisma/client';

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
}
