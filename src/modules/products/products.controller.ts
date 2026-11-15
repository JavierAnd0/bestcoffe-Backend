import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import type { CurrentTenantData } from '../../common/decorators/current-tenant.decorator';
import { ProductsService } from './products.service';
import { ListProductsDto } from './dto/list-products.dto';
import { FeatureGuard } from '../../common/guards/feature.guard';
import { RequireFeature } from '../../common/decorators/require-feature.decorator';

@ApiTags('products')
@Controller('v1/products')
@UseGuards(TenantGuard, FeatureGuard)
@RequireFeature('catalog')
@Public()
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @ApiOkResponse({ description: 'Catálogo público paginado del tenant' })
  list(
    @CurrentTenant() tenant: CurrentTenantData,
    @Query() query: ListProductsDto,
  ) {
    return this.products.list(tenant.id, query);
  }

  @Get(':slug')
  @ApiOkResponse({ description: 'Detalle de producto por slug' })
  findOne(
    @CurrentTenant() tenant: CurrentTenantData,
    @Param('slug') slug: string,
  ) {
    return this.products.findBySlug(tenant.id, slug);
  }
}
