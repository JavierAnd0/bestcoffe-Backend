import { Module } from '@nestjs/common';
import { StripeModule } from '../stripe/stripe.module';
import { AdminSubscriptionsController } from './admin-subscriptions.controller';
import { AdminSubscriptionsService } from './admin-subscriptions.service';
import { CustomerSubscriptionsController } from './customer-subscriptions.controller';
import { CustomerSubscriptionsService } from './customer-subscriptions.service';

@Module({
  imports: [StripeModule],
  controllers: [AdminSubscriptionsController, CustomerSubscriptionsController],
  providers: [AdminSubscriptionsService, CustomerSubscriptionsService],
  exports: [AdminSubscriptionsService],
})
export class SubscriptionsModule {}
