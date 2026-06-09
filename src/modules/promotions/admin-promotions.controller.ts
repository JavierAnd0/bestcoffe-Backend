import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../../common/guards/auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import type { CurrentTenantData } from '../../common/decorators/current-tenant.decorator';
import { AdminPromotionsService } from './admin-promotions.service';
import { CreateDiscountCodeDto } from './dto/create-discount-code.dto';
import { UpdateDiscountCodeDto } from './dto/update-discount-code.dto';
import { ListDiscountCodesDto } from './dto/list-discount-codes.dto';

@ApiTags('admin/promotions')
@ApiBearerAuth()
@Controller('v1/admin/discount-codes')
@UseGuards(AuthGuard, TenantGuard, RolesGuard)
@Roles('TENANT_EDITOR')
@UseInterceptors(AuditInterceptor)
export class AdminPromotionsController {
  constructor(private readonly promotions: AdminPromotionsService) {}

  @Get()
  list(
    @CurrentTenant() tenant: CurrentTenantData,
    @Query() query: ListDiscountCodesDto,
  ) {
    return this.promotions.list(tenant.id, query);
  }

  @Get(':id')
  findOne(
    @CurrentTenant() tenant: CurrentTenantData,
    @Param('id') id: string,
  ) {
    return this.promotions.findOne(tenant.id, id);
  }

  @Post()
  create(
    @CurrentTenant() tenant: CurrentTenantData,
    @Body() dto: CreateDiscountCodeDto,
  ) {
    return this.promotions.create(tenant.id, dto);
  }

  @Patch(':id')
  update(
    @CurrentTenant() tenant: CurrentTenantData,
    @Param('id') id: string,
    @Body() dto: UpdateDiscountCodeDto,
  ) {
    return this.promotions.update(tenant.id, id, dto);
  }

  @Delete(':id')
  remove(
    @CurrentTenant() tenant: CurrentTenantData,
    @Param('id') id: string,
  ) {
    return this.promotions.remove(tenant.id, id);
  }
}
