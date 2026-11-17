import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsHexColor,
  ValidateIf,
  Matches,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** Branding del storefront (colores/tipografía/logo). */
export class BrandingDto {
  @ApiPropertyOptional({ example: '#3B2A1F' })
  @IsOptional()
  @IsHexColor()
  primary?: string;

  @ApiPropertyOptional({ example: '#C8642E' })
  @IsOptional()
  @IsHexColor()
  accent?: string;

  @ApiPropertyOptional({ example: 'editorial' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  font?: string;

  @ApiPropertyOptional({ description: 'URL del logo' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Matches(/^(https:\/\/|\/(?!\/))\S+$/, {
    message: 'El logo debe ser una URL https o una ruta que empiece por /',
  })
  logoUrl?: string;

  // ── Datos de la empresa (factura, textos legales y contacto del storefront).
  // Cadena vacía = borrar el dato (el servicio fusiona el objeto).

  @ApiPropertyOptional({ example: 'Mi Café S.A.S.' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  legalName?: string;

  @ApiPropertyOptional({ example: '900.000.000-0', description: 'NIT' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  legalId?: string;

  @ApiPropertyOptional({ example: 'hola@micafe.co' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== '')
  @IsEmail({}, { message: 'El correo de contacto no es válido' })
  @MaxLength(160)
  contactEmail?: string;

  @ApiPropertyOptional({ example: '+57 300 123 4567' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  contactPhone?: string;

  @ApiPropertyOptional({ example: 'Bogotá' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string;
}

/** Ajustes operativos de envío (se guardan dentro de `features`). */
export class ShippingSettingsDto {
  @ApiPropertyOptional({ description: 'Umbral de envío gratis (centavos COP)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  freeShippingThresholdCents?: number;

  @ApiPropertyOptional({ description: 'Tarifa plana de envío (centavos COP)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  shippingFlatCents?: number;
}

/**
 * Configuración editable por el operador. NO incluye campos controlados por la
 * plataforma (tier, límites de plan, flags de plan, ids de Stripe).
 */
/** Invitación a suscribirse al newsletter (se guarda en `features.newsletter`). */
export class NewsletterSettingsDto {
  @ApiPropertyOptional({
    description: 'Mostrar la invitación discreta a visitantes sin sesión',
  })
  @IsOptional()
  @IsBoolean()
  popupEnabled?: boolean;

  @ApiPropertyOptional({
    description:
      'Código de descuento de bienvenida (debe existir y estar activo). null o vacío = sin oferta.',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  welcomeCode?: string | null;
}

export class UpdateSettingsDto {
  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ type: BrandingDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => BrandingDto)
  branding?: BrandingDto;

  @ApiPropertyOptional({ type: ShippingSettingsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ShippingSettingsDto)
  shipping?: ShippingSettingsDto;

  @ApiPropertyOptional({ type: NewsletterSettingsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => NewsletterSettingsDto)
  newsletter?: NewsletterSettingsDto;
}
