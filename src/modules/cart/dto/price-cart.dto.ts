import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export enum PurchaseMode {
  ONE_TIME = 'ONE_TIME',
  SUBSCRIPTION = 'SUBSCRIPTION',
}

export class CartItemDto {
  @ApiProperty()
  @IsString()
  variantId!: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  quantity!: number;
}

export class PriceCartDto {
  @ApiProperty({ type: [CartItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CartItemDto)
  items!: CartItemDto[];

  @ApiPropertyOptional({ enum: PurchaseMode, default: PurchaseMode.ONE_TIME })
  @IsOptional()
  @IsEnum(PurchaseMode)
  mode?: PurchaseMode = PurchaseMode.ONE_TIME;

  @ApiPropertyOptional({ description: 'Código de descuento a aplicar' })
  @IsOptional()
  @IsString()
  discountCode?: string;
}
