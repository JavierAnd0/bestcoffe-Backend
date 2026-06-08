import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { ProductType } from '@prisma/client';

export enum RoastPreference {
  LIGHT = 'LIGHT',
  MEDIUM = 'MEDIUM',
  DARK = 'DARK',
}

export class QuizAnswersDto {
  @ApiPropertyOptional({ enum: RoastPreference })
  @IsOptional()
  @IsEnum(RoastPreference)
  roast?: RoastPreference;

  @ApiPropertyOptional({
    type: [String],
    description: 'Notas de cata preferidas',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  flavorNotes?: string[];

  @ApiPropertyOptional({ enum: ProductType, description: 'Tipo preferido' })
  @IsOptional()
  @IsEnum(ProductType)
  type?: ProductType;

  @ApiPropertyOptional({ description: 'Prefiere descafeinado' })
  @IsOptional()
  @IsBoolean()
  decaf?: boolean;

  @ApiPropertyOptional({ default: 3, maximum: 6, description: 'Cuántas recomendaciones' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(6)
  limit?: number = 3;
}
