import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { SiteContentKind } from '@prisma/client';

export class ListContentDto {
  @ApiPropertyOptional({ enum: SiteContentKind })
  @IsOptional()
  @IsEnum(SiteContentKind)
  kind?: SiteContentKind;
}
