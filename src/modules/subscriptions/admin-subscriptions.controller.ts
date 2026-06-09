import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
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
import { AdminSubscriptionsService } from './admin-subscriptions.service';
import { ListSubscriptionsDto } from './dto/list-subscriptions.dto';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';

@ApiTags('admin/subscriptions')
@ApiBearerAuth()
@Controller('v1/admin/subscriptions')
@UseGuards(AuthGuard, TenantGuard, RolesGuard)
@Roles('TENANT_ORDERS')
@UseInterceptors(AuditInterceptor)
export class AdminSubscriptionsController {
  constructor(private readonly subscriptions: AdminSubscriptionsService) {}

  @Get()
  list(
    @CurrentTenant() tenant: CurrentTenantData,
    @Query() query: ListSubscriptionsDto,
  ) {
    return this.subscriptions.list(tenant.id, query);
  }

  @Get(':id')
  findOne(
    @CurrentTenant() tenant: CurrentTenantData,
    @Param('id') id: string,
  ) {
    return this.subscriptions.findOne(tenant.id, id);
  }

  @Post(':id/pause')
  @HttpCode(200)
  pause(
    @CurrentTenant() tenant: CurrentTenantData,
    @Param('id') id: string,
  ) {
    return this.subscriptions.pause(tenant.id, id);
  }

  @Post(':id/resume')
  @HttpCode(200)
  resume(
    @CurrentTenant() tenant: CurrentTenantData,
    @Param('id') id: string,
  ) {
    return this.subscriptions.resume(tenant.id, id);
  }

  @Post(':id/skip-next')
  @HttpCode(200)
  skipNext(
    @CurrentTenant() tenant: CurrentTenantData,
    @Param('id') id: string,
  ) {
    return this.subscriptions.skipNext(tenant.id, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(
    @CurrentTenant() tenant: CurrentTenantData,
    @Param('id') id: string,
  ) {
    return this.subscriptions.cancel(tenant.id, id);
  }

  @Patch(':id')
  update(
    @CurrentTenant() tenant: CurrentTenantData,
    @Param('id') id: string,
    @Body() dto: UpdateSubscriptionDto,
  ) {
    return this.subscriptions.update(tenant.id, id, dto);
  }
}
