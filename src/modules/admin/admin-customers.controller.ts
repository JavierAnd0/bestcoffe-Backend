import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../../common/guards/auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import type { CurrentTenantData } from '../../common/decorators/current-tenant.decorator';
import { AdminDashboardService } from './admin-dashboard.service';

@ApiTags('admin/customers')
@ApiBearerAuth()
@Controller('v1/admin/customers')
@UseGuards(AuthGuard, TenantGuard, RolesGuard)
@Roles('TENANT_OWNER', 'TENANT_EDITOR', 'TENANT_ORDERS')
export class AdminCustomersController {
  constructor(private readonly dashboard: AdminDashboardService) {}

  @Get()
  list(
    @CurrentTenant() tenant: CurrentTenantData,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const l = Math.min(parseInt(limit ?? '30', 10) || 30, 100);
    return this.dashboard.listCustomers(tenant.id, cursor, l);
  }
}
