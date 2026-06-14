import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class RedeemGiftDto {
  @ApiProperty({ description: 'Código del regalo (ej. ABCD-EF12-3456)' })
  @IsString()
  redemptionCode: string;

  @ApiPropertyOptional({ description: 'Frecuencia de envío en días', default: 30, minimum: 7, maximum: 365 })
  @IsOptional() @IsInt() @Min(7) @Max(365)
  frequencyDays?: number;

  @ApiPropertyOptional({ description: 'ID de una dirección guardada del cliente' })
  @IsOptional() @IsString()
  addressId?: string;
}
