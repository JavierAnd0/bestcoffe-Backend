import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';
import { GrindFormat } from '@prisma/client';

export class CreateVariantDto {
  @ApiProperty({ description: 'Gramos', example: 250 })
  @IsInt()
  @Min(1)
  sizeGrams!: number;

  @ApiProperty({ enum: GrindFormat })
  @IsEnum(GrindFormat)
  grind!: GrindFormat;

  @ApiProperty({ description: 'Precio compra única (centavos COP)' })
  @IsInt()
  @Min(0)
  priceOneTime!: number;

  @ApiPropertyOptional({ description: 'Precio suscripción (centavos COP)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  priceSubscription?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  stock?: number;
}
