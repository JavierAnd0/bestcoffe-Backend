import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PlatformGuard } from '../../common/guards/platform.guard';
import { PlatformTenantsService } from './platform-tenants.service';
import { CreatePlatformTenantDto } from './dto/create-platform-tenant.dto';
import { UpdatePlatformTenantDto } from './dto/update-platform-tenant.dto';
import { AddTenantDomainDto } from './dto/add-tenant-domain.dto';
import { TenantDomainsService } from '../tenants/tenant-domains.service';

@ApiTags('platform')
@ApiBearerAuth()
@Controller('v1/platform/tenants')
@UseGuards(PlatformGuard)
export class PlatformTenantsController {
  constructor(
    private readonly tenants: PlatformTenantsService,
    private readonly domains: TenantDomainsService,
  ) {}

  @Get()
  list() {
    return this.tenants.list();
  }

  @Post()
  create(@Body() dto: CreatePlatformTenantDto) {
    return this.tenants.create(dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.tenants.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePlatformTenantDto) {
    return this.tenants.update(id, dto);
  }

  // ── Dominios propios ──────────────────────────────────────────────────────
  @Get(':id/domains')
  listDomains(@Param('id') id: string) {
    return this.domains.list(id);
  }

  /** Registra un dominio (sin verificar) y devuelve el TXT que debe publicarse. */
  @Post(':id/domains')
  addDomain(@Param('id') id: string, @Body() dto: AddTenantDomainDto) {
    return this.domains.add(id, dto.domain);
  }

  /** Comprueba el TXT en DNS; solo un dominio verificado enruta a la tienda. */
  @Post(':id/domains/:domainId/verify')
  @HttpCode(200)
  verifyDomain(@Param('id') id: string, @Param('domainId') domainId: string) {
    return this.domains.verify(id, domainId);
  }

  @Delete(':id/domains/:domainId')
  removeDomain(@Param('id') id: string, @Param('domainId') domainId: string) {
    return this.domains.remove(id, domainId);
  }

  @Post(':id/impersonate')
  @HttpCode(200)
  impersonate(@Param('id') id: string) {
    return this.tenants.impersonate(id);
  }
}
