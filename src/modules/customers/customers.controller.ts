import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CustomerAuthGuard } from '../../common/guards/customer-auth.guard';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';
import type { CurrentCustomerData } from '../../common/guards/customer-auth.guard';
import { CustomersService } from './customers.service';
import { UpdateCustomerDto } from './dto/update-customer.dto';

@ApiTags('customers')
@Controller('v1/customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get('me')
  @UseGuards(CustomerAuthGuard)
  @ApiBearerAuth()
  me(@CurrentCustomer() customer: CurrentCustomerData) {
    return this.customers.getMe(customer.id);
  }

  @Patch('me')
  @UseGuards(CustomerAuthGuard)
  @ApiBearerAuth()
  updateMe(
    @CurrentCustomer() customer: CurrentCustomerData,
    @Body() dto: UpdateCustomerDto,
  ) {
    return this.customers.updateMe(customer.id, dto);
  }
}
