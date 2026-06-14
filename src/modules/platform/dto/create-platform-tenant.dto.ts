import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsFQDN,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  Matches,
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
}
