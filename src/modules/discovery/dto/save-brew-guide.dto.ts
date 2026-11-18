import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { SLUG_PATTERN } from '../../content/slug.util';
import { BREW_DIFFICULTIES, type BrewDifficulty } from '../brew-guide-body';

export class BrewStepDto {
  @ApiProperty({ maxLength: 120 })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title!: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  body?: string;

  @ApiPropertyOptional({
    description: 'Duración del paso en segundos',
    default: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(86400)
  durationSec?: number;

  @ApiPropertyOptional({
    description: 'Agua acumulada al terminar el paso, en gramos',
    nullable: true,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(5000)
  waterG?: number | null;
}

/** Receta base: café, agua, temperatura y molienda. Todo opcional. */
export class BrewRecipeDto {
  @ApiPropertyOptional({ description: 'Café en gramos', nullable: true })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(2000)
  coffeeG?: number | null;

  @ApiPropertyOptional({ description: 'Agua en ml', nullable: true })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(10000)
  waterMl?: number | null;

  @ApiPropertyOptional({
    description: 'Temperatura del agua en °C',
    nullable: true,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(100)
  tempC?: number | null;

  @ApiPropertyOptional({
    description: 'Molienda ("Media-fina")',
    maxLength: 60,
  })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  grind?: string;
}

export class CreateBrewGuideDto {
  @ApiProperty({ maxLength: 160 })
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title!: string;

  @ApiPropertyOptional({
    description: 'Nombre corto del método (V60, Prensa francesa…)',
    maxLength: 80,
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  method?: string;

  @ApiPropertyOptional({
    description:
      'Slug único en la tienda (URL /guias/<slug>); si se omite se deriva del método o título',
    maxLength: 120,
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Matches(SLUG_PATTERN, {
    message: 'slug: solo minúsculas, números y guiones (prensa-francesa)',
  })
  slug?: string;

  @ApiPropertyOptional({ maxLength: 600 })
  @IsOptional()
  @IsString()
  @MaxLength(600)
  summary?: string;

  @ApiPropertyOptional({
    description: 'Tiempo total legible ("4 min")',
    maxLength: 40,
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  totalTime?: string;

  @ApiPropertyOptional({ enum: BREW_DIFFICULTIES, default: 'Media' })
  @IsOptional()
  @IsIn(BREW_DIFFICULTIES)
  difficulty?: BrewDifficulty;

  @ApiPropertyOptional({ type: BrewRecipeDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => BrewRecipeDto)
  recipe?: BrewRecipeDto;

  @ApiPropertyOptional({ type: [BrewStepDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => BrewStepDto)
  steps?: BrewStepDto[];

  @ApiPropertyOptional({ maxLength: 500, description: 'URL de la portada' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  coverUrl?: string;
}

/** Edición: todo opcional; si llegan `steps` reemplazan la lista completa. */
export class UpdateBrewGuideDto extends PartialType(CreateBrewGuideDto) {}
