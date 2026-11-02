import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import type { CurrentTenantData } from '../../common/decorators/current-tenant.decorator';
import { NewsletterService } from './newsletter.service';
import { SubscribeNewsletterDto } from './dto/subscribe-newsletter.dto';

@ApiTags('newsletter')
@Controller('v1/newsletter')
@UseGuards(TenantGuard)
@Public()
export class NewsletterController {
  constructor(private readonly newsletter: NewsletterService) {}

  @Post('subscribe')
  @HttpCode(200)
  // Límite estricto por IP: evita usar el formulario para inundar la tabla.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOkResponse({ description: 'Suscripción registrada (respuesta uniforme)' })
  subscribe(
    @CurrentTenant() tenant: CurrentTenantData,
    @Body() dto: SubscribeNewsletterDto,
  ) {
    return this.newsletter.subscribe(tenant.id, dto);
  }
}
