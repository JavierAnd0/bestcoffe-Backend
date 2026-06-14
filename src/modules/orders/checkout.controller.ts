import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CustomerAuthGuard } from '../../common/guards/customer-auth.guard';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';
import type { CurrentCustomerData } from '../../common/guards/customer-auth.guard';
import { CheckoutService } from './checkout.service';
import { CreateOrderDto } from './dto/create-order.dto';

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
  @UseGuards(CustomerAuthGuard)
  create(
    @CurrentCustomer() customer: CurrentCustomerData,
    @Body() dto: CreateOrderDto,
  ) {
    return this.checkout.create(customer.tenantId, customer.id, dto);
  }
}
