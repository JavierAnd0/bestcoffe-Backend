import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import type { CurrentTenantData } from '../../common/decorators/current-tenant.decorator';
import { CollectionsService } from './collections.service';

@ApiTags('collections')
@Controller('v1/collections')
@UseGuards(TenantGuard)
@Public()
export class CollectionsController {
  constructor(private readonly collections: CollectionsService) {}

  @Get()
  @ApiOkResponse({ description: 'Colecciones del tenant con conteo de productos' })
  list(@CurrentTenant() tenant: CurrentTenantData) {
    return this.collections.list(tenant.id);
  }

  @Get(':slug')
  @ApiOkResponse({ description: 'Colección con sus productos resueltos' })
  findOne(
    @CurrentTenant() tenant: CurrentTenantData,
    @Param('slug') slug: string,
  ) {
    return this.collections.findBySlug(tenant.id, slug);
  }
}
