import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

const POSTAL_CODE = /^\d{6}$/;
const POSTAL_CODE_MESSAGE = 'El código postal debe tener 6 dígitos';

/**
 * Dirección guardada del cliente. Se usa para despachar envíos, así que
 * todos los datos de entrega son obligatorios (solo el nombre de la
 * dirección, el país y la predeterminada tienen valor por defecto).
 */
export class CreateAddressDto {
  @ApiPropertyOptional() @IsOptional() @IsString() label?: string;
  @ApiProperty() @IsString() @Length(1, 200) line1: string;
  @ApiProperty() @IsString() @Length(1, 100) line2: string;
  @ApiProperty() @IsString() @Length(2, 100) city: string;
  @ApiProperty() @IsString() @Length(2, 100) state: string;
  @ApiProperty({ example: '110111' })
  @IsString()
  @Matches(POSTAL_CODE, { message: POSTAL_CODE_MESSAGE })
  postalCode: string;
  @ApiPropertyOptional({ default: 'CO' })
  @IsOptional()
  @IsString()
  country?: string;
  @ApiProperty() @IsString() @Length(7, 30) phone: string;
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

/**
 * Edición parcial: un campo puede omitirse, pero si llega no puede venir
 * vacío (no se puede borrar un dato obligatorio al editar).
 */
export class UpdateAddressDto {
  @ApiPropertyOptional() @IsOptional() @IsString() label?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 200)
  line1?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 100)
  line2?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(2, 100)
  city?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(2, 100)
  state?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(POSTAL_CODE, { message: POSTAL_CODE_MESSAGE })
  postalCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() country?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(7, 30)
  phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isDefault?: boolean;
}
