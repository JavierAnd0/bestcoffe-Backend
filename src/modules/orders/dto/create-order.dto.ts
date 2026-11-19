import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
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

/**
 * Dirección del checkout: para despachar un envío todos los datos son
 * obligatorios (quién recibe, complemento, departamento y código postal).
 * La edición desde el panel sigue usando `ShippingAddressDto`, que tolera
 * pedidos antiguos con datos incompletos. Campos sin `@IsOptional` a
 * propósito: no hereda de `ShippingAddressDto` porque class-validator
 * conservaría los `@IsOptional` del padre.
 */
export class CheckoutShippingAddressDto {
  @ApiProperty({ example: 'Ana Pérez', description: 'Quién recibe el pedido' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  recipientName!: string;

  @ApiProperty({ example: 'Calle 123 # 45-67' })
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  line1!: string;

  @ApiProperty({ example: 'Apto 301, Torre 2' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  line2!: string;

  @ApiProperty({ example: 'Bogotá' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  city!: string;

  @ApiProperty({ example: 'Cundinamarca' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  state!: string;

  @ApiProperty({ example: '110111', description: 'Código postal de 6 dígitos' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'El código postal debe tener 6 dígitos' })
  postalCode!: string;

  @ApiPropertyOptional({ default: 'CO' })
  @IsOptional()
  @IsString()
  country?: string = 'CO';

  @ApiProperty({ example: '+57 300 123 4567' })
  @IsString()
  @MinLength(7)
  @MaxLength(30)
  phone!: string;
}

/** Frecuencia por defecto de una suscripción creada en el checkout. */
export const DEFAULT_SUBSCRIPTION_FREQUENCY_DAYS = 30;

/**
 * Línea del pedido. En un pedido por suscripción puede traer su propia
 * frecuencia (cada línea es una suscripción); si no, usa la del pedido.
 */
/** Tipos de documento que acepta ePayco para el pagador. */
export const PAYER_DOC_TYPES = ['CC', 'CE', 'NIT', 'PPN', 'TI'] as const;
export type PayerDocType = (typeof PAYER_DOC_TYPES)[number];

/**
 * Documento de quien paga. Solo se reenvía a la pasarela (ePayco lo pide para
 * tarjeta y PSE) para que el comprador no lo escriba dos veces; NO se guarda
 * en el pedido.
 */
export class PayerDocumentDto {
  @ApiProperty({ enum: PAYER_DOC_TYPES, example: 'CC' })
  @IsEnum(PAYER_DOC_TYPES, { message: 'Tipo de documento inválido' })
  type!: PayerDocType;

  @ApiProperty({ example: '1020304050' })
  @IsString()
  @Matches(/^[0-9A-Za-z]{4,15}$/, {
    message: 'El número de documento debe tener entre 4 y 15 letras o números',
  })
  number!: string;
}

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

  @ApiProperty({ type: CheckoutShippingAddressDto })
  @ValidateNested()
  @Type(() => CheckoutShippingAddressDto)
  shippingAddress!: CheckoutShippingAddressDto;

  @ApiPropertyOptional({
    example: 'https://tienda.com',
    description:
      'Origen de la tienda al que vuelve el comprador tras pagar en MercadoPago. Se acepta solo si es la web de la plataforma o un dominio verificado de la tienda.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  returnOrigin?: string;

  @ApiPropertyOptional({
    type: PayerDocumentDto,
    description:
      'Documento de quien paga, para prellenar la pasarela (ePayco). No se guarda.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => PayerDocumentDto)
  payerDocument?: PayerDocumentDto;
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
