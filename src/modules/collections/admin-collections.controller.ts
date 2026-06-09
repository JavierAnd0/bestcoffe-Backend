import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
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
import { AdminCollectionsService } from './admin-collections.service';
import { CreateCollectionDto } from './dto/create-collection.dto';
import { UpdateCollectionDto } from './dto/update-collection.dto';
import {
  AttachProductsDto,
  ReorderProductsDto,
} from './dto/collection-products.dto';

@ApiTags('admin/collections')
@ApiBearerAuth()
@Controller('v1/admin/collections')
@UseGuards(AuthGuard, TenantGuard, RolesGuard)
@Roles('TENANT_EDITOR')
@UseInterceptors(AuditInterceptor)
export class AdminCollectionsController {
  constructor(private readonly collections: AdminCollectionsService) {}

  @Get()
  list(@CurrentTenant() tenant: CurrentTenantData) {
    return this.collections.list(tenant.id);
  }

  @Get(':id')
  findOne(
    @CurrentTenant() tenant: CurrentTenantData,
    @Param('id') id: string,
  ) {
    return this.collections.findOne(tenant.id, id);
  }

  @Post()
  create(
    @CurrentTenant() tenant: CurrentTenantData,
    @Body() dto: CreateCollectionDto,
  ) {
    return this.collections.create(tenant.id, tenant.slug, dto);
  }

  @Patch(':id')
  update(
    @CurrentTenant() tenant: CurrentTenantData,
    @Param('id') id: string,
    @Body() dto: UpdateCollectionDto,
  ) {
    return this.collections.update(tenant.id, tenant.slug, id, dto);
  }

  @Delete(':id')
  remove(
    @CurrentTenant() tenant: CurrentTenantData,
    @Param('id') id: string,
  ) {
    return this.collections.remove(tenant.id, tenant.slug, id);
  }

  // ── Productos (colecciones MANUAL) ──────────────────────────────────────────

  @Post(':id/products')
  attachProducts(
    @CurrentTenant() tenant: CurrentTenantData,
    @Param('id') id: string,
    @Body() dto: AttachProductsDto,
  ) {
    return this.collections.attachProducts(tenant.id, tenant.slug, id, dto);
  }

  @Patch(':id/products/reorder')
  reorderProducts(
    @CurrentTenant() tenant: CurrentTenantData,
    @Param('id') id: string,
    @Body() dto: ReorderProductsDto,
  ) {
    return this.collections.reorderProducts(tenant.id, tenant.slug, id, dto);
  }

  @Delete(':id/products/:productId')
  detachProduct(
    @CurrentTenant() tenant: CurrentTenantData,
    @Param('id') id: string,
    @Param('productId') productId: string,
  ) {
    return this.collections.detachProduct(tenant.id, tenant.slug, id, productId);
  }
}
