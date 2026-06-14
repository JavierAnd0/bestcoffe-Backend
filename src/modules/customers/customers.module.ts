import { Module } from '@nestjs/common';
import { CustomerAuthController } from './customer-auth.controller';
import { CustomerAuthService } from './customer-auth.service';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { AddressesController } from './addresses.controller';
import { AddressesService } from './addresses.service';

@Module({
  controllers: [CustomerAuthController, CustomersController, AddressesController],
  providers: [CustomerAuthService, CustomersService, AddressesService],
})
export class CustomersModule {}
