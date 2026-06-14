import { Module } from '@nestjs/common';
import { GiftsAdminController } from './gifts-admin.controller';
import { GiftsCustomerController } from './gifts-customer.controller';
import { GiftsService } from './gifts.service';

@Module({
  controllers: [GiftsAdminController, GiftsCustomerController],
  providers: [GiftsService],
})
export class GiftsModule {}
