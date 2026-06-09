import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { SubStatus } from '@prisma/client';

export class ListSubscriptionsDto {
  @ApiPropertyOptional({ enum: SubStatus })
  @IsOptional()
  @IsEnum(SubStatus)
  status?: SubStatus;

  @ApiPropertyOptional({ description: 'Filtra por cliente (id)' })
  @IsOptional()
  @IsString()
  customerId?: string;

  @ApiPropertyOptional({ description: 'Cursor keyset (id del último item)' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ default: 25, maximum: 100 })
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 25;
}
