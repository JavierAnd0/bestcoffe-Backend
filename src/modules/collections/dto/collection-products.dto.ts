import { ApiProperty } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsString } from 'class-validator';

export class AttachProductsDto {
  @ApiProperty({ type: [String], description: 'IDs de producto a vincular' })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  productIds!: string[];
}

export class ReorderProductsDto {
  @ApiProperty({ type: [String], description: 'IDs de producto en el orden deseado' })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  productIds!: string[];
}
