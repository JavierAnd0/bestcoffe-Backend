import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import type { CurrentTenantData } from '../../common/decorators/current-tenant.decorator';
import { TenantsService } from './tenants.service';

@ApiTags('tenants')
@Controller('v1/tenants')
@UseGuards(TenantGuard)
@Public()
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Get('current')
  current(@CurrentTenant() tenant: CurrentTenantData) {
    return this.tenants.getPublicProfile(tenant.id);
  }
}
