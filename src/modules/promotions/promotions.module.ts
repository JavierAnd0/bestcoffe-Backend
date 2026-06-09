import { Module } from '@nestjs/common';
import { AdminPromotionsController } from './admin-promotions.controller';
import { AdminPromotionsService } from './admin-promotions.service';

@Module({
  controllers: [AdminPromotionsController],
  providers: [AdminPromotionsService],
  exports: [AdminPromotionsService],
})
export class PromotionsModule {}
