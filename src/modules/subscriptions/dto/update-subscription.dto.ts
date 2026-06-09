import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** Ediciones administrativas de una suscripción (no cambian su estado). */
export class UpdateSubscriptionDto {
  @ApiPropertyOptional({ description: 'Frecuencia en días (7..365)' })
  @IsOptional()
  @IsInt()
  @Min(7)
  @Max(365)
  frequencyDays?: number;

  @ApiPropertyOptional({ description: 'Descuento por suscripción (0..100)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  discountPct?: number;
}
