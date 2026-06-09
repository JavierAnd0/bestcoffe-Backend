import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { CollectionType } from '@prisma/client';
import { AutoRulesDto } from './auto-rules.dto';

export class CreateCollectionDto {
  @ApiProperty({ maxLength: 120 })
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ description: 'Slug; si se omite se deriva del nombre' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  slug?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ enum: CollectionType, default: CollectionType.MANUAL })
  @IsOptional()
  @IsEnum(CollectionType)
  type?: CollectionType;

  @ApiPropertyOptional({ type: AutoRulesDto, description: 'Reglas (solo type=AUTO)' })
  @IsOptional()
  @ValidateNested()
  @Type(() => AutoRulesDto)
  rules?: AutoRulesDto;

  @ApiPropertyOptional({ description: 'Orden en la navegación', default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;
}
