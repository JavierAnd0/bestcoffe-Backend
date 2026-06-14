import { Module } from '@nestjs/common';
import { CustomerAuthController } from './customer-auth.controller';
import { CustomerAuthService } from './customer-auth.service';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';

@Module({
  controllers: [CustomerAuthController, CustomersController],
  providers: [CustomerAuthService, CustomersService],
})
export class CustomersModule {}
