import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuthGuard } from '../../common/guards/auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import type { CurrentTenantData } from '../../common/decorators/current-tenant.decorator';
import { EnviaAccountService } from './envia-account.service';
import { ShippingService } from './shipping.service';
import {
  CreateLabelDto,
  SaveEnviaConnectionDto,
  ShipmentOverridesDto,
} from './dto/shipping.dto';

/** Cuenta de Envia de la tienda (solo el dueño, como las llaves de pago). */
@ApiTags('admin/shipping')
@ApiBearerAuth()
@Controller('v1/admin/shipping/envia')
@UseGuards(AuthGuard, TenantGuard, RolesGuard)
@Roles('TENANT_OWNER')
@UseInterceptors(AuditInterceptor)
export class EnviaConnectController {
  constructor(private readonly accounts: EnviaAccountService) {}

  @Get()
  status(@CurrentTenant() tenant: CurrentTenantData) {
    return this.accounts.getStatus(tenant.id);
  }

  @Put()
  save(
    @CurrentTenant() tenant: CurrentTenantData,
    @Body() dto: SaveEnviaConnectionDto,
  ) {
    return this.accounts.save(tenant.id, dto);
  }

  @Post('disconnect')
  @HttpCode(200)
  disconnect(@CurrentTenant() tenant: CurrentTenantData) {
    return this.accounts.disconnect(tenant.id);
  }
}

/** Guías de un pedido desde el panel. */
@ApiTags('admin/orders')
@ApiBearerAuth()
@Controller('v1/admin/orders/:orderId/shipping')
@UseGuards(AuthGuard, TenantGuard, RolesGuard)
@Roles('TENANT_ORDERS')
@UseInterceptors(AuditInterceptor)
export class AdminShippingController {
  constructor(private readonly shipping: ShippingService) {}

  @Get()
  list(
    @CurrentTenant() tenant: CurrentTenantData,
    @Param('orderId') orderId: string,
  ) {
    return this.shipping.listShipments(tenant.id, orderId);
  }

  @Post('quotes')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  quote(
    @CurrentTenant() tenant: CurrentTenantData,
    @Param('orderId') orderId: string,
    @Body() dto: ShipmentOverridesDto,
  ) {
    return this.shipping.quote(tenant.id, orderId, dto);
  }

  @Post('label')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  createLabel(
    @CurrentTenant() tenant: CurrentTenantData,
    @Param('orderId') orderId: string,
    @Body() dto: CreateLabelDto,
  ) {
    return this.shipping.createLabel(tenant.id, orderId, dto);
  }

  @Post('label/cancel')
  @HttpCode(200)
  cancelLabel(
    @CurrentTenant() tenant: CurrentTenantData,
    @Param('orderId') orderId: string,
  ) {
    return this.shipping.cancelLabel(tenant.id, orderId);
  }
}

/**
 * Webhook de Envia. Cada tienda registra su propia URL (con su id) al
 * conectar la cuenta; la firma se verifica con el secreto de esa tienda.
 */
@ApiTags('shipping')
@SkipThrottle()
@Controller('v1/shipping/envia')
export class EnviaWebhookController {
  constructor(private readonly shipping: ShippingService) {}

  @Post('webhook/:tenantId')
  @Public()
  @ApiExcludeEndpoint()
  @HttpCode(200)
  webhook(
    @Param('tenantId') tenantId: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Req() req: RawBodyRequest<Request>,
  ) {
    const raw = req.rawBody?.toString('utf8') ?? JSON.stringify(req.body ?? {});
    return this.shipping.handleWebhook(tenantId, headers, raw);
  }
}
