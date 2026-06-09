import {
  Body,
  Controller,
  Get,
  Patch,
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
import { AdminSettingsService } from './admin-settings.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';

@ApiTags('admin/settings')
@ApiBearerAuth()
@Controller('v1/admin/settings')
@UseGuards(AuthGuard, TenantGuard, RolesGuard)
@Roles('TENANT_OWNER')
@UseInterceptors(AuditInterceptor)
export class AdminSettingsController {
  constructor(private readonly settings: AdminSettingsService) {}

  @Get()
  get(@CurrentTenant() tenant: CurrentTenantData) {
    return this.settings.get(tenant.id);
  }

  @Patch()
  update(
    @CurrentTenant() tenant: CurrentTenantData,
    @Body() dto: UpdateSettingsDto,
  ) {
    return this.settings.update(tenant.id, tenant.slug, dto);
  }
}
