import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/** https o ruta local (`/img/…`), nunca `//host`: termina en un `src`. */
export const PAGE_IMAGE_URL = /^(https:\/\/|\/(?!\/))[^\s"'<>]+$/;
/** Enlace de un botón: ruta local, https, correo o teléfono. */
export const PAGE_LINK = /^(\/(?!\/)|https:\/\/|mailto:|tel:)[^\s"'<>]*$/;

export class PageHighlightDto {
  @ApiProperty({ maxLength: 40, example: '+40' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  value!: string;

  @ApiProperty({ maxLength: 160 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  label!: string;
}

export class PageSectionDto {
  @ApiPropertyOptional({ maxLength: 160 })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  title?: string;

  @ApiPropertyOptional({
    maxLength: 8000,
    description:
      'Texto. Línea en blanco = nuevo párrafo; líneas que empiezan por "- " = lista.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  body?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Matches(PAGE_IMAGE_URL, {
    message: 'La imagen debe ser una URL https o una ruta que empiece por /',
  })
  imageUrl?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  imageAlt?: string;
}

export class PageCtaDto {
  @ApiPropertyOptional({ maxLength: 160 })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  title?: string;

  @ApiPropertyOptional({ maxLength: 600 })
  @IsOptional()
  @IsString()
  @MaxLength(600)
  body?: string;

  @ApiPropertyOptional({ maxLength: 60 })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  label?: string;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  @Matches(PAGE_LINK, {
    message: 'El enlace debe empezar por /, https://, mailto: o tel:',
  })
  href?: string;

  @ApiPropertyOptional({ maxLength: 60 })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  secondaryLabel?: string;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  @Matches(PAGE_LINK, {
    message: 'El enlace debe empezar por /, https://, mailto: o tel:',
  })
  secondaryHref?: string;
}

export class PageContactDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail({}, { message: 'El correo de contacto no es válido' })
  @MaxLength(200)
  email?: string;

  @ApiPropertyOptional({ maxLength: 40 })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;
}

/** Contenido de una página editorial (historia, impacto, sostenibilidad, mayoristas). */
export class EditorialPageContentDto {
  @ApiPropertyOptional({ maxLength: 60, description: 'Antetítulo' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  eyebrow?: string;

  @ApiProperty({ maxLength: 160 })
  @IsString()
  @IsNotEmpty({ message: 'La página necesita un título' })
  @MaxLength(160)
  title!: string;

  @ApiPropertyOptional({ maxLength: 600, description: 'Entradilla' })
  @IsOptional()
  @IsString()
  @MaxLength(600)
  intro?: string;

  @ApiPropertyOptional({ maxLength: 500, description: 'Imagen principal' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Matches(PAGE_IMAGE_URL, {
    message: 'La imagen debe ser una URL https o una ruta que empiece por /',
  })
  imageUrl?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  imageAlt?: string;

  @ApiPropertyOptional({ maxLength: 300, description: 'Texto sobre la imagen' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  imageCaption?: string;

  @ApiPropertyOptional({ type: [PageHighlightDto], maxItems: 8 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => PageHighlightDto)
  highlights?: PageHighlightDto[];

  @ApiPropertyOptional({ maxLength: 60 })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  sectionsEyebrow?: string;

  @ApiPropertyOptional({ maxLength: 160 })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  sectionsTitle?: string;

  @ApiProperty({ type: [PageSectionDto], maxItems: 20 })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => PageSectionDto)
  sections!: PageSectionDto[];

  @ApiPropertyOptional({ type: PageCtaDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PageCtaDto)
  cta?: PageCtaDto;

  @ApiPropertyOptional({ type: PageContactDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PageContactDto)
  contact?: PageContactDto;
}

export class SaveEditorialPageDto {
  @ApiPropertyOptional({ description: 'Activar o desactivar la página' })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ type: EditorialPageContentDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => EditorialPageContentDto)
  content?: EditorialPageContentDto;
}
