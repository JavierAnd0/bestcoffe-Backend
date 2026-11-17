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
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../../common/guards/auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import type { CurrentTenantData } from '../../common/decorators/current-tenant.decorator';
import { AdminLocationsService } from './admin-locations.service';
import { CreateLocationDto, UpdateLocationDto } from './dto/save-location.dto';

/**
 * Sin @RequireFeature a propósito: la lectura pública de sedes
 * (`v1/locations`) tampoco depende del plan; existen en todos los tiers.
 */
@ApiTags('admin/locations')
@ApiBearerAuth()
@Controller('v1/admin/locations')
@UseGuards(AuthGuard, TenantGuard, RolesGuard)
@Roles('TENANT_EDITOR')
@UseInterceptors(AuditInterceptor)
export class AdminLocationsController {
  constructor(private readonly locations: AdminLocationsService) {}

  @Get()
  @ApiOkResponse({ description: 'Sedes físicas de la tienda' })
  list(@CurrentTenant() tenant: CurrentTenantData) {
    return this.locations.list(tenant.id);
  }

  @Get(':id')
  findOne(@CurrentTenant() tenant: CurrentTenantData, @Param('id') id: string) {
    return this.locations.findOne(tenant.id, id);
  }

  @Post()
  create(
    @CurrentTenant() tenant: CurrentTenantData,
    @Body() dto: CreateLocationDto,
  ) {
    return this.locations.create(tenant.id, tenant.slug, dto);
  }

  @Patch(':id')
  update(
    @CurrentTenant() tenant: CurrentTenantData,
    @Param('id') id: string,
    @Body() dto: UpdateLocationDto,
  ) {
    return this.locations.update(tenant.id, tenant.slug, id, dto);
  }

  @Delete(':id')
  remove(@CurrentTenant() tenant: CurrentTenantData, @Param('id') id: string) {
    return this.locations.remove(tenant.id, tenant.slug, id);
  }
}
