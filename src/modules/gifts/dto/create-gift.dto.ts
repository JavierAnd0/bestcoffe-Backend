import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateGiftDto {
  @ApiProperty() @IsString() variantId: string;
  @ApiProperty({ description: 'Email del comprador / remitente del regalo' })
  @IsEmail()
  buyerEmail: string;
  @ApiProperty({ description: 'Número de envíos incluidos en el regalo', minimum: 1, maximum: 24 })
  @IsInt() @Min(1) @Max(24)
  totalShipments: number;
  @ApiPropertyOptional() @IsOptional() @IsString() message?: string;
}
