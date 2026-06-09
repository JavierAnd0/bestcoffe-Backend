import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsObject,
  IsOptional,
  Min,
} from 'class-validator';

/**
 * Edición de un bloque: el `kind` es inmutable (cambiar de tipo = crear otro).
 * Si se envía `data`, se valida contra el `kind` existente.
 */
export class UpdateContentDto {
  @ApiPropertyOptional({
    description: 'Nuevo payload; se valida según el `kind` del bloque',
    type: 'object',
    additionalProperties: true,
  })
  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ description: 'Inicio de vigencia (ISO)', nullable: true })
  @IsOptional()
  @IsDateString()
  startsAt?: string | null;

  @ApiPropertyOptional({ description: 'Fin de vigencia (ISO)', nullable: true })
  @IsOptional()
  @IsDateString()
  endsAt?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;
}
