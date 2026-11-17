import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { SLUG_PATTERN } from '../../content/slug.util';

/**
 * Alta de un artículo del blog. El cuerpo es texto plano: la tienda pública
 * muestra cada bloque separado por una línea en blanco como un párrafo.
 */
export class CreateBlogPostDto {
  @ApiProperty({ maxLength: 160 })
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title!: string;

  @ApiPropertyOptional({
    description: 'Slug único en la tienda; si se omite se deriva del título',
    maxLength: 120,
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Matches(SLUG_PATTERN, {
    message: 'slug: solo minúsculas, números y guiones (mi-articulo)',
  })
  slug?: string;

  @ApiPropertyOptional({ maxLength: 400, description: 'Entradilla / resumen' })
  @IsOptional()
  @IsString()
  @MaxLength(400)
  excerpt?: string;

  @ApiProperty({
    description:
      'Texto del artículo; párrafos separados por una línea en blanco',
    maxLength: 50000,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(50000)
  body!: string;

  @ApiPropertyOptional({ maxLength: 500, description: 'URL de la portada' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  coverUrl?: string;

  @ApiPropertyOptional({
    default: false,
    description: 'true = publicado; false = borrador',
  })
  @IsOptional()
  @IsBoolean()
  published?: boolean;

  @ApiPropertyOptional({
    description:
      'Fecha de publicación (ISO). Solo con published=true; una fecha futura programa el artículo',
  })
  @IsOptional()
  @IsDateString()
  publishedAt?: string;
}

/** Edición: todo opcional. `excerpt`/`coverUrl` vacíos se borran. */
export class UpdateBlogPostDto extends PartialType(CreateBlogPostDto) {}
