import { Controller, Headers, HttpCode, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { StripeService } from './stripe.service';

@ApiExcludeController()
@Controller('v1/stripe')
export class StripeController {
  constructor(private readonly stripe: StripeService) {}

  /**
   * Stripe llama este endpoint con el body sin parsear y la firma en el header.
   * IMPORTANTE: el ValidationPipe global no debe tocar este endpoint (Public +
   * rawBody). NestJS pasa el Buffer crudo cuando rawBody:true está activo.
   */
  @Post('webhook')
  @Public()
  @HttpCode(200)
  webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ) {
    return this.stripe.handleWebhook(req.rawBody!, signature);
  }
}
