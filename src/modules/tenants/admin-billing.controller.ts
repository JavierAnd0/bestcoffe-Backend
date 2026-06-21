import {
  Controller,
  Get,
  HttpCode,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../../common/guards/auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import type { CurrentTenantData } from '../../common/decorators/current-tenant.decorator';
import { AdminBillingService } from './admin-billing.service';

@ApiTags('admin/billing')
@ApiBearerAuth()
@Controller('v1/admin/billing')
@UseGuards(AuthGuard, TenantGuard, RolesGuard)
@Roles('TENANT_OWNER')
@UseInterceptors(AuditInterceptor)
export class AdminBillingController {
  constructor(private readonly billing: AdminBillingService) {}

  @Get()
  get(@CurrentTenant() tenant: CurrentTenantData) {
    return this.billing.get(tenant.id);
  }

  @Post('commission/accept')
  @HttpCode(200)
  accept(@CurrentTenant() tenant: CurrentTenantData) {
    return this.billing.acceptCommission(tenant.id);
  }

  @Post('commission/reject')
  @HttpCode(200)
  reject(@CurrentTenant() tenant: CurrentTenantData) {
    return this.billing.rejectCommission(tenant.id);
  }
}
