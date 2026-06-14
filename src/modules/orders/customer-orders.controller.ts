import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CustomerAuthGuard } from '../../common/guards/customer-auth.guard';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';
import type { CurrentCustomerData } from '../../common/guards/customer-auth.guard';
import { CustomerOrdersService } from './customer-orders.service';

class ListMyOrdersDto {
  @ApiPropertyOptional() @IsOptional() @IsString() cursor?: string;
  @ApiPropertyOptional({ default: 20, maximum: 50 })
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt() @Min(1) @Max(50)
  limit?: number = 20;
}

@ApiTags('orders')
@ApiBearerAuth()
@Controller('v1/orders')
@UseGuards(CustomerAuthGuard)
export class CustomerOrdersController {
  constructor(private readonly orders: CustomerOrdersService) {}

  @Get()
  list(
    @CurrentCustomer() customer: CurrentCustomerData,
    @Query() query: ListMyOrdersDto,
  ) {
    return this.orders.list(customer.id, query.cursor, query.limit);
  }

  @Get(':id')
  findOne(
    @CurrentCustomer() customer: CurrentCustomerData,
    @Param('id') id: string,
  ) {
    return this.orders.findOne(customer.id, id);
  }
}
