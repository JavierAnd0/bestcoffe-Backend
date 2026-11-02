import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { ApiCreatedResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { FeatureGuard } from '../../common/guards/feature.guard';
import { RequireFeature } from '../../common/decorators/require-feature.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import type { CurrentTenantData } from '../../common/decorators/current-tenant.decorator';
import { TurnstileService } from '../../common/services/turnstile.service';
import { ReviewsService } from './reviews.service';
import { CreateReviewDto } from './dto/create-review.dto';

@ApiTags('reviews')
@Controller('v1/reviews')
@UseGuards(TenantGuard, FeatureGuard)
@Public()
export class ReviewsController {
  constructor(
    private readonly reviews: ReviewsService,
    private readonly turnstile: TurnstileService,
  ) {}

  @Post()
  @RequireFeature('reviews')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiCreatedResponse({ description: 'Reseña creada en estado PENDING' })
  async create(
    @CurrentTenant() tenant: CurrentTenantData,
    @Body() dto: CreateReviewDto,
    @Req() req: Request,
  ) {
    await this.turnstile.verifyToken(dto.turnstileToken, req.ip);
    return this.reviews.create(tenant.id, dto);
  }
}
