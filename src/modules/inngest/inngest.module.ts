import { Module } from '@nestjs/common';
import { InngestController } from './inngest.controller';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { EpaycoModule } from '../epayco/epayco.module';

@Module({
  imports: [SubscriptionsModule, EpaycoModule],
  controllers: [InngestController],
})
export class InngestModule {}
