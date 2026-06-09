import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
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
import { AdminOrdersService } from './admin-orders.service';
import { ListOrdersDto } from './dto/list-orders.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { UpdateOrderDto } from './dto/update-order.dto';

@ApiTags('admin/orders')
@ApiBearerAuth()
@Controller('v1/admin/orders')
@UseGuards(AuthGuard, TenantGuard, RolesGuard)
@Roles('TENANT_ORDERS')
@UseInterceptors(AuditInterceptor)
export class AdminOrdersController {
  constructor(private readonly orders: AdminOrdersService) {}

  @Get()
  list(
    @CurrentTenant() tenant: CurrentTenantData,
    @Query() query: ListOrdersDto,
  ) {
    return this.orders.list(tenant.id, query);
  }

  @Get(':id')
  findOne(
    @CurrentTenant() tenant: CurrentTenantData,
    @Param('id') id: string,
  ) {
    return this.orders.findOne(tenant.id, id);
  }

  @Patch(':id/status')
  updateStatus(
    @CurrentTenant() tenant: CurrentTenantData,
    @Param('id') id: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.orders.updateStatus(tenant.id, id, dto);
  }

  @Patch(':id')
  update(
    @CurrentTenant() tenant: CurrentTenantData,
    @Param('id') id: string,
    @Body() dto: UpdateOrderDto,
  ) {
    return this.orders.update(tenant.id, id, dto);
  }
}
