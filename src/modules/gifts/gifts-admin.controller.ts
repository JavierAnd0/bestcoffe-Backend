import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { AuthGuard } from '../../common/guards/auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import type { CurrentTenantData } from '../../common/decorators/current-tenant.decorator';
import { GiftsService } from './gifts.service';
import { CreateGiftDto } from './dto/create-gift.dto';

class ListGiftsDto {
  @ApiPropertyOptional({ default: 25, maximum: 100 })
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt() @Min(1) @Max(100)
  limit?: number = 25;

  @ApiPropertyOptional() @IsOptional() @IsString() cursor?: string;
}

@ApiTags('admin/gifts')
@ApiBearerAuth()
@Controller('v1/admin/gifts')
@UseGuards(AuthGuard, TenantGuard, RolesGuard)
@Roles('TENANT_ORDERS')
@UseInterceptors(AuditInterceptor)
export class GiftsAdminController {
  constructor(private readonly gifts: GiftsService) {}

  @Get()
  list(
    @CurrentTenant() tenant: CurrentTenantData,
    @Query() query: ListGiftsDto,
  ) {
    return this.gifts.list(tenant.id, query.cursor, query.limit);
  }

  @Post()
  create(
    @CurrentTenant() tenant: CurrentTenantData,
    @Body() dto: CreateGiftDto,
  ) {
    return this.gifts.create(tenant.id, dto);
  }
}
