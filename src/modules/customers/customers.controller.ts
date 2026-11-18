import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Patch,
  UseGuards,
} from '@nestjs/common';
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

  /** "Eliminar mi cuenta": anonimiza al cliente y cancela sus suscripciones. */
  @Delete('me')
  @UseGuards(CustomerAuthGuard)
  @ApiBearerAuth()
  @HttpCode(200)
  deleteMe(@CurrentCustomer() customer: CurrentCustomerData) {
    return this.customers.deleteMe(customer.id);
  }
}
