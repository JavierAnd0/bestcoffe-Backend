import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, ValidateNested } from 'class-validator';
import { CartItemDto } from './price-cart.dto';

export class MergeCartDto {
  @ApiProperty({
    type: [CartItemDto],
    description: 'Lista de items locales de localStorage para fusionar',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CartItemDto)
  items!: CartItemDto[];
}

