import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CustomerAuthGuard } from '../../common/guards/customer-auth.guard';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';
import type { CurrentCustomerData } from '../../common/guards/customer-auth.guard';
import { GiftsService } from './gifts.service';
import { RedeemGiftDto } from './dto/redeem-gift.dto';

@ApiTags('gifts')
@ApiBearerAuth()
@Controller('v1/gifts')
@UseGuards(CustomerAuthGuard)
export class GiftsCustomerController {
  constructor(private readonly gifts: GiftsService) {}

  @Post('redeem')
  @HttpCode(200)
  redeem(
    @CurrentCustomer() customer: CurrentCustomerData,
    @Body() dto: RedeemGiftDto,
  ) {
    return this.gifts.redeem(customer.id, customer.tenantId, dto);
  }
}
