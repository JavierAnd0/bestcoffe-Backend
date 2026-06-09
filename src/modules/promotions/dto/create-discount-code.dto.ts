import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { DiscountType } from '@prisma/client';

export class CreateDiscountCodeDto {
  @ApiProperty({ description: 'Se normaliza a MAYÚSCULAS', example: 'BIENVENIDO10' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Z0-9_-]{3,40}$/, {
    message: 'code: 3-40 chars, solo A-Z, 0-9, guion o guion bajo',
  })
  @MaxLength(40)
  code!: string;

  @ApiProperty({ enum: DiscountType, default: DiscountType.PERCENTAGE })
  @IsEnum(DiscountType)
  type!: DiscountType;

  @ApiProperty({ description: 'PERCENTAGE: 1-100 · FIXED: centavos COP' })
  @IsInt()
  @Min(1)
  value!: number;

  @ApiPropertyOptional({ description: 'Mínimo de compra en centavos' })
  @IsOptional()
  @IsInt()
  @Min(0)
  minSubtotalCents?: number;

  @ApiPropertyOptional({ description: 'Tope de redenciones totales' })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxRedemptions?: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  oneUsePerCustomer?: boolean;

  @ApiPropertyOptional({ description: 'Inicio de vigencia (ISO)' })
  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @ApiPropertyOptional({ description: 'Fin de vigencia (ISO)' })
  @IsOptional()
  @IsDateString()
  endsAt?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
