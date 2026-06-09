import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ProductType } from '@prisma/client';

/**
 * Reglas de una colección AUTO. Se guardan tal cual en `Collection.rules` (JSON)
 * y las traduce a un `where` de Prisma `CollectionsService.resolveAuto`.
 */
export class AutoRulesDto {
  @ApiPropertyOptional({ enum: ProductType })
  @IsOptional()
  @IsEnum(ProductType)
  type?: ProductType;

  @ApiPropertyOptional({ description: 'Tostado mínimo (1..9)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(9)
  roastLevelGte?: number;

  @ApiPropertyOptional({ description: 'Tostado máximo (1..9)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(9)
  roastLevelLte?: number;

  @ApiPropertyOptional({ description: 'Nota de cata que debe contener' })
  @IsOptional()
  @IsString()
  flavorNote?: string;

  @ApiPropertyOptional({ description: 'Badge que debe contener' })
  @IsOptional()
  @IsString()
  badge?: string;
}
