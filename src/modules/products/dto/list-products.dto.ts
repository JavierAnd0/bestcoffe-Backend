import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { ProductType } from '@prisma/client';

export class ListProductsDto {
  @ApiPropertyOptional({ enum: ProductType })
  @IsOptional()
  @IsEnum(ProductType)
  type?: ProductType;

  @ApiPropertyOptional({ description: 'Tostado mínimo (1..9)' })
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  @Max(9)
  roastMin?: number;

  @ApiPropertyOptional({ description: 'Nota de cata a filtrar' })
  @IsOptional()
  @IsString()
  flavorNote?: string;

  @ApiPropertyOptional({ description: 'Slug de colección' })
  @IsOptional()
  @IsString()
  collection?: string;

  @ApiPropertyOptional({ default: 24, maximum: 100 })
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 24;

  @ApiPropertyOptional({ description: 'Cursor keyset (id del último item)' })
  @IsOptional()
  @IsString()
  cursor?: string;
}
