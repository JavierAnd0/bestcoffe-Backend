import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../../common/guards/auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import type { CurrentTenantData } from '../../common/decorators/current-tenant.decorator';
import { AdminDashboardService } from './admin-dashboard.service';

@ApiTags('admin/dashboard')
@ApiBearerAuth()
@Controller('v1/admin/dashboard')
@UseGuards(AuthGuard, TenantGuard, RolesGuard)
@Roles('TENANT_OWNER', 'TENANT_EDITOR')
export class AdminDashboardController {
  constructor(private readonly dashboard: AdminDashboardService) {}

  @Get('kpis')
  kpis(@CurrentTenant() tenant: CurrentTenantData) {
    return this.dashboard.getKpis(tenant.id);
  }

  @Get('alerts')
  alerts(@CurrentTenant() tenant: CurrentTenantData) {
    return this.dashboard.getAlerts(tenant.id);
  }

  @Get('sales')
  sales(
    @CurrentTenant() tenant: CurrentTenantData,
    @Query('days') days?: string,
  ) {
    const d = Math.min(Math.max(parseInt(days ?? '14', 10) || 14, 1), 90);
    return this.dashboard.getSales(tenant.id, d);
  }
}
