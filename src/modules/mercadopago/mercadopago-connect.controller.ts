import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../../common/guards/auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import type { CurrentTenantData } from '../../common/decorators/current-tenant.decorator';
import { MercadoPagoService } from './mercadopago.service';

@ApiTags('admin/mercadopago')
@ApiBearerAuth()
@Controller('v1/admin/mercadopago')
@UseGuards(AuthGuard, TenantGuard, RolesGuard)
@Roles('TENANT_OWNER')
export class MercadoPagoConnectController {
  constructor(private readonly mp: MercadoPagoService) {}

  /** Devuelve la URL de autorización para conectar la cuenta MercadoPago. */
  @Get('connect')
  async connect(@CurrentTenant() tenant: CurrentTenantData) {
    const url = await this.mp.buildConnectUrl(tenant.id);
    return { url };
  }

  @Get('status')
  status(@CurrentTenant() tenant: CurrentTenantData) {
    return this.mp.getConnectionStatus(tenant.id);
  }

  @Post('disconnect')
  @HttpCode(200)
  disconnect(@CurrentTenant() tenant: CurrentTenantData) {
    return this.mp.disconnect(tenant.id);
  }
}
