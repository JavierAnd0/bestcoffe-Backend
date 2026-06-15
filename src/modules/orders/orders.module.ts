import { Module } from '@nestjs/common';
import { CartModule } from '../cart/cart.module';
import { StripeModule } from '../stripe/stripe.module';
import { MercadoPagoModule } from '../mercadopago/mercadopago.module';
import { AdminOrdersController } from './admin-orders.controller';
import { AdminOrdersService } from './admin-orders.service';
import { CheckoutController } from './checkout.controller';
import { CheckoutService } from './checkout.service';
import { CustomerOrdersController } from './customer-orders.controller';
import { CustomerOrdersService } from './customer-orders.service';

@Module({
  imports: [CartModule, StripeModule, MercadoPagoModule],
  controllers: [
    AdminOrdersController,
    CheckoutController,
    CustomerOrdersController,
  ],
  providers: [AdminOrdersService, CheckoutService, CustomerOrdersService],
  exports: [AdminOrdersService],
})
export class OrdersModule {}
