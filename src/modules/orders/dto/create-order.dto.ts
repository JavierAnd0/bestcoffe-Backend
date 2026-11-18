import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CartItemDto, PurchaseMode } from '../../cart/dto/price-cart.dto';

export class ShippingAddressDto {
  @ApiPropertyOptional({
    example: 'Ana Pérez',
    description:
      'Quién recibe el pedido (puede no ser el titular de la cuenta)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  recipientName?: string;

  @ApiProperty({ example: 'Calle 123 # 45-67' })
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  line1!: string;

  @ApiPropertyOptional({ example: 'Apto 301' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  line2?: string;

  @ApiProperty({ example: 'Bogotá' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  city!: string;

  @ApiPropertyOptional({ example: 'Cundinamarca' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  state?: string;

  @ApiPropertyOptional({ example: '110111' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  postalCode?: string;

  @ApiPropertyOptional({ default: 'CO' })
  @IsOptional()
  @IsString()
  country?: string = 'CO';

  @ApiPropertyOptional({ example: '+57 300 123 4567' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;
}

/** Frecuencia por defecto de una suscripción creada en el checkout. */
export const DEFAULT_SUBSCRIPTION_FREQUENCY_DAYS = 30;

/**
 * Línea del pedido. En un pedido por suscripción puede traer su propia
 * frecuencia (cada línea es una suscripción); si no, usa la del pedido.
 */
export class OrderItemDto extends CartItemDto {
  @ApiPropertyOptional({
    minimum: 7,
    maximum: 365,
    description: 'Solo en modo SUBSCRIPTION: cada cuántos días se envía',
  })
  @IsOptional()
  @IsInt()
  @Min(7)
  @Max(365)
  frequencyDays?: number;
}

export class CreateOrderDto {
  @ApiProperty({ type: [OrderItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items!: OrderItemDto[];

  @ApiPropertyOptional({ enum: PurchaseMode, default: PurchaseMode.ONE_TIME })
  @IsOptional()
  @IsEnum(PurchaseMode)
  mode?: PurchaseMode = PurchaseMode.ONE_TIME;

  @ApiPropertyOptional({
    minimum: 7,
    maximum: 365,
    default: DEFAULT_SUBSCRIPTION_FREQUENCY_DAYS,
    description:
      'Solo en modo SUBSCRIPTION: frecuencia de envío en días (las líneas pueden fijar la suya)',
  })
  @IsOptional()
  @IsInt()
  @Min(7)
  @Max(365)
  frequencyDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  discountCode?: string;

  @ApiProperty({ type: ShippingAddressDto })
  @ValidateNested()
  @Type(() => ShippingAddressDto)
  shippingAddress!: ShippingAddressDto;

  @ApiPropertyOptional({
    example: 'https://tienda.com',
    description:
      'Origen de la tienda al que vuelve el comprador tras pagar en MercadoPago. Se acepta solo si es la web de la plataforma o un dominio verificado de la tienda.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  returnOrigin?: string;
}

/**
 * Pedido de invitado (sin sesión). El correo identifica a quién pertenece el
 * pedido, pero NO se considera verificado: este flujo nunca entrega una sesión.
 */
export class CreateGuestOrderDto extends CreateOrderDto {
  @ApiProperty({ example: 'cliente@correo.com' })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiPropertyOptional({ example: 'María García' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;
}
