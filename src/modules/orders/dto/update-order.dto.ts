import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaymentStatus } from '@prisma/client';

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

  @ApiPropertyOptional({ description: 'Notas internas (no visibles al cliente)' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  internalNotes?: string;
}
