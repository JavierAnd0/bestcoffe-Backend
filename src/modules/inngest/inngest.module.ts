import { Module } from '@nestjs/common';
import { InngestController } from './inngest.controller';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [SubscriptionsModule],
  controllers: [InngestController],
})
export class InngestModule {}
