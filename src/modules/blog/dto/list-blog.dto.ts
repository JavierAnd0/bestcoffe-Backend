import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class ListBlogDto {
  @ApiPropertyOptional({ default: 12, maximum: 50 })
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 12;

  @ApiPropertyOptional({ description: 'Cursor keyset (id del último post)' })
  @IsOptional()
  @IsString()
  cursor?: string;
}
