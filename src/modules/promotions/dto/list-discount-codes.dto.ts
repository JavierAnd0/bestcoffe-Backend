import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

export class ListDiscountCodesDto {
  @ApiPropertyOptional({ description: 'Filtra por estado activo' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : (value as boolean),
  )
  @IsBoolean()
  active?: boolean;
}
