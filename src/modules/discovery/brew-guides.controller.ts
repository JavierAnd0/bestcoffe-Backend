import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import type { CurrentTenantData } from '../../common/decorators/current-tenant.decorator';
import { BrewGuidesService } from './brew-guides.service';

class ListBrewGuidesDto {
  @ApiPropertyOptional({ default: 12, maximum: 50 })
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt() @Min(1) @Max(50)
  limit?: number = 12;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cursor?: string;
}

@ApiTags('brew-guides')
@Controller('v1/brew-guides')
@UseGuards(TenantGuard)
@Public()
export class BrewGuidesController {
  constructor(private readonly guides: BrewGuidesService) {}

  @Get()
  list(
    @CurrentTenant() tenant: CurrentTenantData,
    @Query() query: ListBrewGuidesDto,
  ) {
    return this.guides.list(tenant.id, query.cursor, query.limit);
  }

  @Get(':slug')
  findOne(
    @CurrentTenant() tenant: CurrentTenantData,
    @Param('slug') slug: string,
  ) {
    return this.guides.findBySlug(tenant.id, slug);
  }
}
