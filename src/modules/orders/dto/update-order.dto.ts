import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { PaymentStatus } from '@prisma/client';
import { ShippingAddressDto } from './create-order.dto';

/** Ediciones administrativas que no cambian el estado de fulfillment. */
export class UpdateOrderDto {
  @ApiPropertyOptional({ enum: PaymentStatus })
  @IsOptional()
  @IsEnum(PaymentStatus)
  paymentStatus?: PaymentStatus;

  @ApiPropertyOptional({ description: 'URL de seguimiento de envío' })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  trackingUrl?: string;

  @ApiPropertyOptional({
    description: 'Notas internas (no visibles al cliente)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  internalNotes?: string;

  @ApiPropertyOptional({
    type: ShippingAddressDto,
    description:
      'Corrige la dirección de envío. Solo antes del despacho (Recibido o En preparación).',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ShippingAddressDto)
  shippingAddress?: ShippingAddressDto;
}
