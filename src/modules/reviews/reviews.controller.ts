import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiCreatedResponse, ApiTags } from '@nestjs/swagger';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { FeatureGuard } from '../../common/guards/feature.guard';
import { RequireFeature } from '../../common/decorators/require-feature.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import type { CurrentTenantData } from '../../common/decorators/current-tenant.decorator';
import { ReviewsService } from './reviews.service';
import { CreateReviewDto } from './dto/create-review.dto';

@ApiTags('reviews')
@Controller('v1/reviews')
@UseGuards(TenantGuard, FeatureGuard)
@Public()
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Post()
  @RequireFeature('reviews')
  @ApiCreatedResponse({ description: 'Reseña creada en estado PENDING' })
  create(
    @CurrentTenant() tenant: CurrentTenantData,
    @Body() dto: CreateReviewDto,
  ) {
    return this.reviews.create(tenant.id, dto);
  }
}
