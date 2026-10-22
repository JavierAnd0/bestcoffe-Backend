import { Module } from '@nestjs/common';
import { StripeModule } from '../stripe/stripe.module';
import { AdminSubscriptionsController } from './admin-subscriptions.controller';
import { AdminSubscriptionsService } from './admin-subscriptions.service';
import { CustomerSubscriptionsController } from './customer-subscriptions.controller';
import { CustomerSubscriptionsService } from './customer-subscriptions.service';
import { SubscriptionRenewalService } from './subscription-renewal.service';

@Module({
  imports: [StripeModule],
  controllers: [AdminSubscriptionsController, CustomerSubscriptionsController],
  providers: [
    AdminSubscriptionsService,
    CustomerSubscriptionsService,
    SubscriptionRenewalService,
  ],
  exports: [AdminSubscriptionsService, SubscriptionRenewalService],
})
export class SubscriptionsModule {}
