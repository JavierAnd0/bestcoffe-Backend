import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CustomerAuthGuard } from '../../common/guards/customer-auth.guard';
import type { CurrentCustomerData } from '../../common/guards/customer-auth.guard';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';
import { AddressesService } from './addresses.service';
import { CreateAddressDto, UpdateAddressDto } from './dto/address.dto';

@ApiTags('addresses')
@ApiBearerAuth()
@Controller('v1/customers/me/addresses')
@UseGuards(CustomerAuthGuard)
export class AddressesController {
  constructor(private readonly addresses: AddressesService) {}

  @Get()
  list(@CurrentCustomer() customer: CurrentCustomerData) {
    return this.addresses.list(customer.id);
  }

  @Post()
  create(
    @CurrentCustomer() customer: CurrentCustomerData,
    @Body() dto: CreateAddressDto,
  ) {
    return this.addresses.create(customer.id, customer.tenantId, dto);
  }

  @Patch(':id')
  update(
    @CurrentCustomer() customer: CurrentCustomerData,
    @Param('id') id: string,
    @Body() dto: UpdateAddressDto,
  ) {
    return this.addresses.update(customer.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentCustomer() customer: CurrentCustomerData,
    @Param('id') id: string,
  ) {
    return this.addresses.remove(customer.id, id);
  }
}
