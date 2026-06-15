import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { MercadoPagoService } from './mercadopago.service';

@ApiExcludeController()
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
