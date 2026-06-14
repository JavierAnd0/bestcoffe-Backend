import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateSubscriptionDto {
  @ApiProperty() @IsString() variantId: string;

  @ApiProperty({ minimum: 7, maximum: 365 })
  @IsInt()
  @Min(7)
  @Max(365)
  frequencyDays: number;

  @ApiPropertyOptional({ description: 'ID de una dirección guardada del cliente' })
  @IsOptional()
  @IsString()
  addressId?: string;
}
