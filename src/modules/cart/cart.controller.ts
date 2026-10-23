import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { CustomerAuthGuard } from '../../common/guards/customer-auth.guard';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import type { CurrentTenantData } from '../../common/decorators/current-tenant.decorator';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';
import type { CurrentCustomerData } from '../../common/guards/customer-auth.guard';
import { CartService } from './cart.service';
import { PriceCartDto } from './dto/price-cart.dto';
import { CartPriceResponseDto } from './dto/cart-price-response.dto';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';
import { MergeCartDto } from './dto/merge-cart.dto';
import { CustomerCartResponseDto } from './dto/customer-cart-response.dto';

@ApiTags('cart')
@Controller('v1/cart')
export class CartController {
  constructor(private readonly cart: CartService) {}

  /**
   * Cálculo stateless de precios de carrito (abierto para visitantes anónimos / invitados).
   */
  @Post('price')
  @Public()
  @UseGuards(TenantGuard)
  @HttpCode(200)
  @ApiOkResponse({ type: CartPriceResponseDto })
  price(
    @CurrentTenant() tenant: CurrentTenantData,
    @Body() dto: PriceCartDto,
  ): Promise<CartPriceResponseDto> {
    return this.cart.price(tenant.id, dto);
  }

  /**
   * Obtiene el carrito persistente guardado en la cuenta del cliente.
   */
  @Get()
  @UseGuards(CustomerAuthGuard)
  @ApiBearerAuth()
  @ApiOkResponse({ type: CustomerCartResponseDto })
  getCart(
    @CurrentCustomer() customer: CurrentCustomerData,
    @Query('discountCode') discountCode?: string,
  ): Promise<CustomerCartResponseDto> {
    return this.cart.getCart(customer.tenantId, customer.id, discountCode);
  }

  /**
   * Agrega o incrementa un producto en el carrito persistente del cliente.
   */
  @Post('items')
  @UseGuards(CustomerAuthGuard)
  @ApiBearerAuth()
  @ApiOkResponse({ type: CustomerCartResponseDto })
  addItem(
    @CurrentCustomer() customer: CurrentCustomerData,
    @Body() dto: AddCartItemDto,
  ): Promise<CustomerCartResponseDto> {
    return this.cart.addItem(customer.tenantId, customer.id, dto);
  }

  /**
   * Modifica la cantidad de una variante en el carrito del cliente (0 para eliminar).
   */
  @Patch('items/:variantId')
  @UseGuards(CustomerAuthGuard)
  @ApiBearerAuth()
  @ApiOkResponse({ type: CustomerCartResponseDto })
  updateItem(
    @CurrentCustomer() customer: CurrentCustomerData,
    @Param('variantId') variantId: string,
    @Body() dto: UpdateCartItemDto,
  ): Promise<CustomerCartResponseDto> {
    return this.cart.updateItem(customer.tenantId, customer.id, variantId, dto);
  }

  /**
   * Elimina un producto específico del carrito del cliente.
   */
  @Delete('items/:variantId')
  @UseGuards(CustomerAuthGuard)
  @ApiBearerAuth()
  @ApiOkResponse({ type: CustomerCartResponseDto })
  removeItem(
    @CurrentCustomer() customer: CurrentCustomerData,
    @Param('variantId') variantId: string,
  ): Promise<CustomerCartResponseDto> {
    return this.cart.removeItem(customer.tenantId, customer.id, variantId);
  }

  /**
   * Vacía el carrito del cliente (ej. al completar la compra).
   */
  @Delete()
  @UseGuards(CustomerAuthGuard)
  @ApiBearerAuth()
  clearCart(
    @CurrentCustomer() customer: CurrentCustomerData,
  ): Promise<{ message: string }> {
    return this.cart.clearCart(customer.tenantId, customer.id);
  }

  /**
   * Fusiona los items que el usuario agregó mientras era invitado (en localStorage)
   * con su carrito en la base de datos tras iniciar sesión.
   */
  @Post('merge')
  @UseGuards(CustomerAuthGuard)
  @ApiBearerAuth()
  @HttpCode(200)
  @ApiOkResponse({ type: CustomerCartResponseDto })
  mergeCart(
    @CurrentCustomer() customer: CurrentCustomerData,
    @Body() dto: MergeCartDto,
  ): Promise<CustomerCartResponseDto> {
    return this.cart.mergeCart(customer.tenantId, customer.id, dto);
  }
}
