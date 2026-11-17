import {
  Body,
  Controller,
  Get,
  Param,
  Put,
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
import { AdminPagesService } from './admin-pages.service';
import { SaveEditorialPageDto } from './dto/editorial-page.dto';

/**
 * Páginas editoriales de la tienda (historia, impacto, sostenibilidad,
 * mayoristas) y el interruptor de la página de sedes.
 *
 * Sin @RequireFeature a propósito, como guías y sedes: son páginas de marca
 * que existen en todos los planes (la lectura pública tampoco depende del plan).
 */
@ApiTags('admin/pages')
@ApiBearerAuth()
@Controller('v1/admin/pages')
@UseGuards(AuthGuard, TenantGuard, RolesGuard)
@Roles('TENANT_EDITOR')
@UseInterceptors(AuditInterceptor)
export class AdminPagesController {
  constructor(private readonly pages: AdminPagesService) {}

  @Get()
  @ApiOkResponse({
    description: 'Páginas editoriales con su estado y contenido',
  })
  list(@CurrentTenant() tenant: CurrentTenantData) {
    return this.pages.list(tenant.id);
  }

  @Get(':slug')
  findOne(
    @CurrentTenant() tenant: CurrentTenantData,
    @Param('slug') slug: string,
  ) {
    return this.pages.findOne(tenant.id, slug);
  }

  @Put(':slug')
  save(
    @CurrentTenant() tenant: CurrentTenantData,
    @Param('slug') slug: string,
    @Body() dto: SaveEditorialPageDto,
  ) {
    return this.pages.save(tenant.id, tenant.slug, slug, dto);
  }
}
