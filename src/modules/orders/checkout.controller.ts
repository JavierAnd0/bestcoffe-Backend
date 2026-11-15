import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CustomerAuthGuard } from '../../common/guards/customer-auth.guard';
import { FeatureGuard } from '../../common/guards/feature.guard';
import { RequireFeature } from '../../common/decorators/require-feature.decorator';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';
import type { CurrentCustomerData } from '../../common/guards/customer-auth.guard';
import { CheckoutService } from './checkout.service';
import { CreateGuestOrderDto, CreateOrderDto } from './dto/create-order.dto';
import { InternalSecretGuard } from '../../common/guards/internal-secret.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import type { CurrentTenantData } from '../../common/decorators/current-tenant.decorator';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('orders')
@ApiBearerAuth()
@Controller('v1/orders')
export class CheckoutController {
  constructor(private readonly checkout: CheckoutService) {}

  /**
   * Inicia el proceso de pago de una compra única.
   * Devuelve el clientSecret de Stripe para completar el pago en el front
   * con stripe.confirmPayment(). El webhook payment_intent.succeeded marca
   * la orden como PAID y decrementa stock.
   */
  @Post()
  @UseGuards(CustomerAuthGuard, FeatureGuard)
  @RequireFeature('checkout')
  create(
    @CurrentCustomer() customer: CurrentCustomerData,
    @Body() dto: CreateOrderDto,
  ) {
    return this.checkout.create(customer.tenantId, customer.id, dto);
  }

  /**
   * Compra de invitado, servidor a servidor: solo el front (con el secreto
   * interno) puede llamarlo. Crea el pedido para el correo indicado y NO
   * devuelve ninguna sesión — ver CheckoutService.createGuest.
   */
  @Post('guest')
  @Public()
  @UseGuards(TenantGuard, FeatureGuard, InternalSecretGuard)
  @RequireFeature('checkout')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiHeader({
    name: 'x-internal-secret',
    description: 'Secreto compartido (REVALIDATE_SECRET) entre front y API',
    required: true,
  })
  createGuest(
    @CurrentTenant() tenant: CurrentTenantData,
    @Body() dto: CreateGuestOrderDto,
  ) {
    return this.checkout.createGuest(tenant.id, dto);
  }
}
