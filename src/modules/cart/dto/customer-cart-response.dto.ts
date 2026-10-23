import { ApiProperty } from '@nestjs/swagger';
import { CartPriceResponseDto } from './cart-price-response.dto';

export class CustomerCartItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  variantId!: string;

  @ApiProperty()
  quantity!: number;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export class CustomerCartResponseDto extends CartPriceResponseDto {
  @ApiProperty({
    type: [CustomerCartItemDto],
    description: 'Registros base en BD con ID y cantidad',
  })
  rawItems!: CustomerCartItemDto[];
}

