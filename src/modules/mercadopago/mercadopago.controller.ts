import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { MercadoPagoService } from './mercadopago.service';
import { SyncPaymentDto } from './dto/sync-payment.dto';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { InternalSecretGuard } from '../../common/guards/internal-secret.guard';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import type { CurrentTenantData } from '../../common/decorators/current-tenant.decorator';

@ApiExcludeController()
@SkipThrottle()
@Controller('v1/mercadopago')
export class MercadoPagoController {
  constructor(
    private readonly mp: MercadoPagoService,
    private readonly config: ConfigService,
  ) {}

  /** Notificaciones de MercadoPago (IPN/webhook). Firma validada en el service. */
  @Post('webhook')
  @Public()
  @HttpCode(200)
  webhook(
    @Query() query: Record<string, string>,
    @Headers() headers: Record<string, string>,
    @Body() body: { type?: string; data?: { id?: string } },
  ) {
    return this.mp.handleWebhook(query, headers, body);
  }

  /**
   * Regreso de Checkout Pro: la confirmación de la tienda (servidor a
   * servidor, con el secreto interno) pide el estado real del pago sin
   * esperar el webhook. Solo aplica pagos de esa tienda y de ese pedido.
   */
  @Post('sync')
  @Public()
  @UseGuards(TenantGuard, InternalSecretGuard)
  // La clase salta el límite (el webhook de MercadoPago); este sí lo lleva.
  @SkipThrottle({ default: false })
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(200)
  sync(
    @CurrentTenant() tenant: CurrentTenantData,
    @Body() dto: SyncPaymentDto,
  ) {
    return this.mp.syncPayment(tenant.id, dto.orderId, dto.paymentId);
  }

  /**
   * Callback OAuth (redirect del navegador). El `state` firmado identifica al
   * tenant; tras intercambiar el code se redirige al panel admin.
   */
  @Get('oauth/callback')
  @Public()
  async oauthCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    const webUrl = this.config.get<string>('webAppUrl') ?? '';
    try {
      const tenantId = await this.mp.resolveOAuthState(state);
      await this.mp.exchangeCodeAndStore(tenantId, code);
      return res.redirect(`${webUrl}/admin/configuracion?mp=connected`);
    } catch {
      return res.redirect(`${webUrl}/admin/configuracion?mp=error`);
    }
  }
}
