import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsHexColor,
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
  logoUrl?: string;
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
