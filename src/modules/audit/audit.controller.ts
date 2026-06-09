import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../../common/guards/auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import type { CurrentTenantData } from '../../common/decorators/current-tenant.decorator';
import { AuditService } from './audit.service';
import { ListAuditLogsDto } from './dto/list-audit-logs.dto';

@ApiTags('admin/audit')
@ApiBearerAuth()
@Controller('v1/admin/audit-logs')
@UseGuards(AuthGuard, TenantGuard, RolesGuard)
@Roles('TENANT_OWNER')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list(
    @CurrentTenant() tenant: CurrentTenantData,
    @Query() query: ListAuditLogsDto,
  ) {
    return this.audit.list(tenant.id, query);
  }

  @Get(':id')
  findOne(
    @CurrentTenant() tenant: CurrentTenantData,
    @Param('id') id: string,
  ) {
    return this.audit.findOne(tenant.id, id);
  }
}
