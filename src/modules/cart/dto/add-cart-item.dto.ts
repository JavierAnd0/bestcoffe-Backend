import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsString, Max, Min } from 'class-validator';

export class AddCartItemDto {
  @ApiProperty({ description: 'ID de la variante de producto' })
  @IsString()
  @IsNotEmpty()
  variantId!: string;

  @ApiProperty({
    description: 'Cantidad a agregar al carrito',
    minimum: 1,
    maximum: 99,
    default: 1,
  })
  @IsInt()
  @Min(1)
  @Max(99)
  quantity: number = 1;
}

