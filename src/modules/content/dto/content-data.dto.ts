import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/** Call-to-action reutilizable en anuncios y hero. */
export class CtaDto {
  @ApiProperty({ maxLength: 60 })
  @IsString()
  @MaxLength(60)
  label!: string;

  @ApiProperty({ maxLength: 300 })
  @IsString()
  @MaxLength(300)
  href!: string;
}

/** data de un bloque ANNOUNCEMENT. */
export class AnnouncementDataDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  text!: string;

  @ApiPropertyOptional({ type: CtaDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CtaDto)
  cta?: CtaDto;
}

/** data de un bloque HERO. */
export class HeroDataDto {
  @ApiProperty({ maxLength: 120 })
  @IsString()
  @MaxLength(120)
  title!: string;

  @ApiPropertyOptional({ maxLength: 240 })
  @IsOptional()
  @IsString()
  @MaxLength(240)
  subtitle?: string;

  @ApiPropertyOptional({ type: CtaDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CtaDto)
  cta?: CtaDto;

  @ApiProperty({ description: 'URL imagen desktop' })
  @IsString()
  @MaxLength(500)
  imageDesktop!: string;

  @ApiPropertyOptional({ description: 'URL imagen móvil' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  imageMobile?: string;
}

/** data de un bloque SPOTLIGHT (destaca un producto). */
export class SpotlightDataDto {
  @ApiProperty({ description: 'Slug del producto destacado' })
  @IsString()
  @MaxLength(120)
  productSlug!: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;
}

/** data de un bloque FEATURED_BUNDLE. */
export class FeaturedBundleDataDto {
  @ApiProperty({ maxLength: 120 })
  @IsString()
  @MaxLength(120)
  title!: string;

  @ApiProperty({ type: [String], description: 'Slugs de producto del bundle' })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  productSlugs!: string[];
}
