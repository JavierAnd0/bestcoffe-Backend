import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiCreatedResponse, ApiTags } from '@nestjs/swagger';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import type { CurrentTenantData } from '../../common/decorators/current-tenant.decorator';
import { ReviewsService } from './reviews.service';
import { CreateReviewDto } from './dto/create-review.dto';

@ApiTags('reviews')
@Controller('v1/reviews')
@UseGuards(TenantGuard)
@Public()
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Post()
  @ApiCreatedResponse({ description: 'Reseña creada en estado PENDING' })
  create(
    @CurrentTenant() tenant: CurrentTenantData,
    @Body() dto: CreateReviewDto,
  ) {
    return this.reviews.create(tenant.id, dto);
  }
}
