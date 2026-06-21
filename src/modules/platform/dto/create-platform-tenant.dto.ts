import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsFQDN,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { Tier } from '@prisma/client';

export class CreatePlatformTenantDto {
  @ApiProperty({ description: 'Slug único (solo letras minúsculas, números y guiones)', example: 'cafe-roma' })
  @IsString()
  @Matches(/^[a-z0-9-]+$/, { message: 'El slug solo puede contener letras minúsculas, números y guiones' })
  slug: string;

  @ApiProperty({ example: 'Café Roma' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ enum: Tier, default: Tier.STARTER })
  @IsOptional()
  @IsIn(Object.values(Tier))
  tier?: Tier;

  @ApiProperty({ description: 'Email del primer TENANT_OWNER', example: 'owner@caferoma.com' })
  @IsEmail()
  ownerEmail: string;

  @ApiPropertyOptional({ example: 'María García' })
  @IsOptional()
  @IsString()
  ownerName?: string;

  @ApiPropertyOptional({ description: 'Dominio personalizado (sin https://)', example: 'tienda.caferoma.com' })
  @IsOptional()
  @IsFQDN()
  domain?: string;

  @ApiPropertyOptional({ description: 'Feature flags iniciales', example: { subscriptions: true } })
  @IsOptional()
  @IsObject()
  features?: Record<string, unknown>;

  @ApiPropertyOptional({
    description:
      'Habilita el cobro por comisión (solo PRO/BUSINESS). Solo puede definirse al crear.',
  })
  @IsOptional()
  @IsBoolean()
  commissionEnabled?: boolean;

  @ApiPropertyOptional({ description: '% de comisión inicial (si commissionEnabled)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  commissionPct?: number;
}
