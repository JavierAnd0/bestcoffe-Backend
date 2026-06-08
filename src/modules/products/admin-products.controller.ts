import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ProductStatus } from '@prisma/client';
import { AuthGuard } from '../../common/guards/auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import type { CurrentTenantData } from '../../common/decorators/current-tenant.decorator';
import { AdminProductsService } from './admin-products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { CreateVariantDto } from './dto/create-variant.dto';
import { UpdateVariantDto } from './dto/update-variant.dto';
import { AttachImageDto, ReorderImagesDto } from './dto/images.dto';

@ApiTags('admin/products')
@ApiBearerAuth()
@Controller('v1/admin/products')
@UseGuards(AuthGuard, TenantGuard, RolesGuard)
@Roles('TENANT_EDITOR')
@UseInterceptors(AuditInterceptor)
export class AdminProductsController {
  constructor(private readonly products: AdminProductsService) {}

  @Get()
  list(
    @CurrentTenant() tenant: CurrentTenantData,
    @Query('status') status?: ProductStatus,
    @Query('cursor') cursor?: string,
  ) {
    return this.products.list(tenant.id, status, cursor);
  }

  @Get(':id')
  findOne(
    @CurrentTenant() tenant: CurrentTenantData,
    @Param('id') id: string,
  ) {
    return this.products.findOne(tenant.id, id);
  }

  @Post()
  create(
    @CurrentTenant() tenant: CurrentTenantData,
    @Body() dto: CreateProductDto,
  ) {
    return this.products.create(tenant.id, tenant.slug, dto);
  }

  @Patch(':id')
  update(
    @CurrentTenant() tenant: CurrentTenantData,
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.products.update(tenant.id, tenant.slug, id, dto);
  }

  @Post(':id/archive')
  @HttpCode(200)
  archive(
    @CurrentTenant() tenant: CurrentTenantData,
    @Param('id') id: string,
  ) {
    return this.products.archive(tenant.id, tenant.slug, id);
  }

  // ── Variantes ─────────────────────────────────────────────────────────────

  @Post(':id/variants')
  addVariant(
    @CurrentTenant() tenant: CurrentTenantData,
    @Param('id') id: string,
    @Body() dto: CreateVariantDto,
  ) {
    return this.products.addVariant(tenant.id, tenant.slug, id, dto);
  }

  @Patch('variants/:variantId')
  updateVariant(
    @CurrentTenant() tenant: CurrentTenantData,
    @Param('variantId') variantId: string,
    @Body() dto: UpdateVariantDto,
  ) {
    return this.products.updateVariant(tenant.id, tenant.slug, variantId, dto);
  }

  @Delete('variants/:variantId')
  removeVariant(
    @CurrentTenant() tenant: CurrentTenantData,
    @Param('variantId') variantId: string,
  ) {
    return this.products.removeVariant(tenant.id, tenant.slug, variantId);
  }

  // ── Imágenes ──────────────────────────────────────────────────────────────

  @Post(':id/images')
  attachImage(
    @CurrentTenant() tenant: CurrentTenantData,
    @Param('id') id: string,
    @Body() dto: AttachImageDto,
  ) {
    return this.products.attachImage(tenant.id, tenant.slug, id, dto);
  }

  @Patch(':id/images/reorder')
  reorderImages(
    @CurrentTenant() tenant: CurrentTenantData,
    @Param('id') id: string,
    @Body() dto: ReorderImagesDto,
  ) {
    return this.products.reorderImages(tenant.id, tenant.slug, id, dto);
  }

  @Delete('images/:imageId')
  removeImage(
    @CurrentTenant() tenant: CurrentTenantData,
    @Param('imageId') imageId: string,
  ) {
    return this.products.removeImage(tenant.id, tenant.slug, imageId);
  }
}
