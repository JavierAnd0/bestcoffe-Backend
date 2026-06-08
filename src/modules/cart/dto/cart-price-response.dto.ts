import { ApiProperty } from '@nestjs/swagger';
import { GrindFormat } from '@prisma/client';

export class CartLineDto {
  @ApiProperty() variantId!: string;
  @ApiProperty() productSlug!: string;
  @ApiProperty() productName!: string;
  @ApiProperty() sizeGrams!: number;
  @ApiProperty({ enum: GrindFormat }) grind!: GrindFormat;
  @ApiProperty({ description: 'Precio unitario en centavos COP' }) unitCents!: number;
  @ApiProperty() quantity!: number;
  @ApiProperty() lineCents!: number;
  @ApiProperty({ description: 'Stock insuficiente para la cantidad pedida' })
  outOfStock!: boolean;
}

export class CartDiscountDto {
  @ApiProperty() code!: string;
  @ApiProperty() valid!: boolean;
  @ApiProperty() amountCents!: number;
  @ApiProperty({ required: false }) reason?: string;
}

export class CartPriceResponseDto {
  @ApiProperty({ type: [CartLineDto] }) lines!: CartLineDto[];
  @ApiProperty() subtotalCents!: number;
  @ApiProperty() discountCents!: number;
  @ApiProperty() shippingCents!: number;
  @ApiProperty() totalCents!: number;
  @ApiProperty({ description: 'Faltó stock en alguna línea' }) hasStockIssues!: boolean;
  @ApiProperty({ type: CartDiscountDto, required: false })
  discount?: CartDiscountDto;
}
