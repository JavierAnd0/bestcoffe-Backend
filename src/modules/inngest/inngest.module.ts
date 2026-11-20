import { Module } from '@nestjs/common';
import { InngestController } from './inngest.controller';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { EpaycoModule } from '../epayco/epayco.module';
import { ShippingModule } from '../shipping/shipping.module';

@Module({
  imports: [SubscriptionsModule, EpaycoModule, ShippingModule],
  controllers: [InngestController],
})
export class InngestModule {}
