import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CustomerAuthGuard } from '../../common/guards/customer-auth.guard';
import { FeatureGuard } from '../../common/guards/feature.guard';
import { RequireFeature } from '../../common/decorators/require-feature.decorator';
import type { CurrentCustomerData } from '../../common/guards/customer-auth.guard';
import { CurrentCustomer } from '../../common/decorators/current-customer.decorator';
import { CustomerSubscriptionsService } from './customer-subscriptions.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';

class ListMySubsDto {
  @ApiPropertyOptional() @IsOptional() @IsString() cursor?: string;
  @ApiPropertyOptional({ default: 20, maximum: 50 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? parseInt(value, 10) : Number(value),
  )
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 20;
}

/** El cliente solo puede cambiar la frecuencia (el descuento lo fija la tienda). */
class UpdateMySubDto {
  @ApiProperty({ minimum: 7, maximum: 365 })
  @IsInt()
  @Min(7)
  @Max(365)
  frequencyDays!: number;
}

@ApiTags('subscriptions')
@ApiBearerAuth()
@Controller('v1/subscriptions')
@UseGuards(CustomerAuthGuard, FeatureGuard)
export class CustomerSubscriptionsController {
  constructor(private readonly subs: CustomerSubscriptionsService) {}

  @Get()
  list(
    @CurrentCustomer() customer: CurrentCustomerData,
    @Query() query: ListMySubsDto,
  ) {
    return this.subs.list(customer.id, query.cursor, query.limit);
  }

  @Get(':id')
  findOne(
    @CurrentCustomer() customer: CurrentCustomerData,
    @Param('id') id: string,
  ) {
    return this.subs.findOne(customer.id, id);
  }

  @Post()
  @RequireFeature('subscriptions')
  create(
    @CurrentCustomer() customer: CurrentCustomerData,
    @Body() dto: CreateSubscriptionDto,
  ) {
    return this.subs.create(customer.id, customer.tenantId, dto);
  }

  @Patch(':id')
  update(
    @CurrentCustomer() customer: CurrentCustomerData,
    @Param('id') id: string,
    @Body() dto: UpdateMySubDto,
  ) {
    return this.subs.updateFrequency(customer.id, id, dto.frequencyDays);
  }

  @Post(':id/pause')
  @HttpCode(200)
  pause(
    @CurrentCustomer() customer: CurrentCustomerData,
    @Param('id') id: string,
  ) {
    return this.subs.pause(customer.id, id);
  }

  @Post(':id/resume')
  @HttpCode(200)
  resume(
    @CurrentCustomer() customer: CurrentCustomerData,
    @Param('id') id: string,
  ) {
    return this.subs.resume(customer.id, id);
  }

  @Post(':id/skip-next')
  @HttpCode(200)
  skipNext(
    @CurrentCustomer() customer: CurrentCustomerData,
    @Param('id') id: string,
  ) {
    return this.subs.skipNext(customer.id, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(
    @CurrentCustomer() customer: CurrentCustomerData,
    @Param('id') id: string,
  ) {
    return this.subs.cancel(customer.id, id);
  }
}
