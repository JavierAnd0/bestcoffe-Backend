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
import { AdminBrewGuidesService } from './admin-brew-guides.service';
import {
  CreateBrewGuideDto,
  UpdateBrewGuideDto,
} from './dto/save-brew-guide.dto';

/**
 * Sin @RequireFeature a propósito: la lectura pública de guías
 * (`v1/brew-guides`) tampoco depende del plan; existen en todos los tiers.
 */
@ApiTags('admin/brew-guides')
@ApiBearerAuth()
@Controller('v1/admin/brew-guides')
@UseGuards(AuthGuard, TenantGuard, RolesGuard)
@Roles('TENANT_EDITOR')
@UseInterceptors(AuditInterceptor)
export class AdminBrewGuidesController {
  constructor(private readonly guides: AdminBrewGuidesService) {}

  @Get()
  @ApiOkResponse({ description: 'Guías de la tienda con sus pasos' })
  list(@CurrentTenant() tenant: CurrentTenantData) {
    return this.guides.list(tenant.id);
  }

  @Get(':id')
  findOne(@CurrentTenant() tenant: CurrentTenantData, @Param('id') id: string) {
    return this.guides.findOne(tenant.id, id);
  }

  @Post()
  create(
    @CurrentTenant() tenant: CurrentTenantData,
    @Body() dto: CreateBrewGuideDto,
  ) {
    return this.guides.create(tenant.id, tenant.slug, dto);
  }

  @Patch(':id')
  update(
    @CurrentTenant() tenant: CurrentTenantData,
    @Param('id') id: string,
    @Body() dto: UpdateBrewGuideDto,
  ) {
    return this.guides.update(tenant.id, tenant.slug, id, dto);
  }

  @Delete(':id')
  remove(@CurrentTenant() tenant: CurrentTenantData, @Param('id') id: string) {
    return this.guides.remove(tenant.id, tenant.slug, id);
  }
}
