import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import type { CurrentTenantData } from '../../common/decorators/current-tenant.decorator';
import { CartService } from './cart.service';
import { PriceCartDto } from './dto/price-cart.dto';
import { CartPriceResponseDto } from './dto/cart-price-response.dto';

@ApiTags('cart')
@Controller('v1/cart')
@UseGuards(TenantGuard)
@Public()
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Post('price')
  @HttpCode(200)
  @ApiOkResponse({ type: CartPriceResponseDto })
  price(
    @CurrentTenant() tenant: CurrentTenantData,
    @Body() dto: PriceCartDto,
  ): Promise<CartPriceResponseDto> {
    return this.cart.price(tenant.id, dto);
  }
}
