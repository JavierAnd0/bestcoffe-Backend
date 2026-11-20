import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

/** Dirección desde donde la tienda despacha. */
export class ShippingOriginDto {
  @ApiProperty({ example: 'Tostadores del Valle' })
  @IsString()
  @Length(2, 80)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  company?: string;

  @ApiProperty({ example: '3001234567' })
  @IsString()
  @Length(7, 20)
  phone!: string;

  @ApiPropertyOptional() @IsOptional() @IsEmail() email?: string;

  @ApiProperty({ example: 'Calle 10 # 5-20' })
  @IsString()
  @Length(3, 120)
  street!: string;

  @ApiPropertyOptional({ example: 'Bodega 2' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference?: string;

  @ApiProperty({ example: 'Medellín' })
  @IsString()
  @Length(2, 80)
  city!: string;

  @ApiProperty({
    example: 'Antioquia',
    description: 'Departamento o su código de Envia',
  })
  @IsString()
  @Length(2, 80)
  state!: string;

  @ApiPropertyOptional({ description: 'NIT o cédula del remitente' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  identificationNumber?: string;
}

/** Caja por defecto. El peso sale de los productos del pedido. */
export class ShippingPackageDefaultsDto {
  @ApiProperty({ example: 20 }) @IsInt() @Min(1) @Max(200) lengthCm!: number;
  @ApiProperty({ example: 15 }) @IsInt() @Min(1) @Max(200) widthCm!: number;
  @ApiProperty({ example: 10 }) @IsInt() @Min(1) @Max(200) heightCm!: number;
  @ApiProperty({ example: 150, description: 'Peso de la caja y el relleno' })
  @IsInt()
  @Min(0)
  @Max(5000)
  packagingGrams!: number;
}

export class SaveEnviaConnectionDto {
  @ApiPropertyOptional({
    description:
      'Token de API de Envia. Se puede omitir para editar solo la dirección si la tienda ya está conectada.',
  })
  @IsOptional()
  @IsString()
  @MinLength(20)
  @MaxLength(4000)
  token?: string;

  @ApiPropertyOptional({
    description:
      'Secreto de firma de webhooks, si Envia lo muestra en el panel. Cadena vacía lo borra; sin él se usa el token.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  webhookSecret?: string;

  @ApiProperty({ description: 'true = sandbox de Envia' })
  @IsBoolean()
  test!: boolean;

  @ApiProperty({ type: ShippingOriginDto })
  @ValidateNested()
  @Type(() => ShippingOriginDto)
  origin!: ShippingOriginDto;

  @ApiProperty({ type: ShippingPackageDefaultsDto })
  @ValidateNested()
  @Type(() => ShippingPackageDefaultsDto)
  package!: ShippingPackageDefaultsDto;
}

/** Ajustes opcionales del paquete y del destino para una cotización o guía. */
export class ShipmentOverridesDto {
  @ApiPropertyOptional({ example: 1.2 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.1)
  @Max(150)
  weightKg?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  lengthCm?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  widthCm?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  heightCm?: number;

  @ApiPropertyOptional({
    example: '05001000',
    description:
      'Código DANE de 8 dígitos del destino, si Envia no reconoce la ciudad',
  })
  @IsOptional()
  @Matches(/^\d{8}$/, { message: 'El código DANE tiene 8 dígitos' })
  destinationCityCode?: string;

  @ApiPropertyOptional({
    example: 'AN',
    description: 'Código de departamento de Envia',
  })
  @IsOptional()
  @Matches(/^[A-Z]{2,3}$/, { message: 'Código de departamento inválido' })
  destinationStateCode?: string;
}

export const PRINT_SIZES = [
  'PAPER_4X6',
  'PAPER_LETTER',
  'STOCK_4X6',
  'PAPER_7X4.75',
] as const;

export class CreateLabelDto extends ShipmentOverridesDto {
  @ApiProperty({ example: 'coordinadora' })
  @IsString()
  @Length(2, 60)
  carrier!: string;

  @ApiProperty({ example: 'ground' })
  @IsString()
  @Length(1, 60)
  service!: string;

  @ApiPropertyOptional({ enum: PRINT_SIZES, default: 'PAPER_4X6' })
  @IsOptional()
  @IsIn(PRINT_SIZES)
  printSize?: (typeof PRINT_SIZES)[number];
}
