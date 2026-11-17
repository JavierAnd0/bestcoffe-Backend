import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/** Sede física de la tienda (página pública /tiendas). */
export class CreateLocationDto {
  @ApiProperty({ maxLength: 120, example: 'Sede Chapinero' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ maxLength: 200, example: 'Cra 13 #57-32' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  address!: string;

  @ApiProperty({ maxLength: 80, example: 'Bogotá' })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  city!: string;

  @ApiPropertyOptional({ maxLength: 40, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string | null;

  @ApiPropertyOptional({
    maxLength: 200,
    nullable: true,
    description: 'Horario legible ("Lun–Sáb · 8:00–18:00")',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  hours?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Latitud (mapa)' })
  @IsOptional()
  @IsLatitude()
  lat?: number | null;

  @ApiPropertyOptional({ nullable: true, description: 'Longitud (mapa)' })
  @IsOptional()
  @IsLongitude()
  lng?: number | null;
}

/** Edición: todo opcional; `null` o "" borra los campos opcionales. */
export class UpdateLocationDto extends PartialType(CreateLocationDto) {}
