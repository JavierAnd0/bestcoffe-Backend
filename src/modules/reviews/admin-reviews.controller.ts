import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ReviewStatus } from '@prisma/client';
import { AuthGuard } from '../../common/guards/auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import type { CurrentTenantData } from '../../common/decorators/current-tenant.decorator';
import { AdminReviewsService } from './admin-reviews.service';
import { ApproveReviewDto, ReplyReviewDto } from './dto/moderate-review.dto';

@ApiTags('admin/reviews')
@ApiBearerAuth()
@Controller('v1/admin/reviews')
@UseGuards(AuthGuard, TenantGuard, RolesGuard)
@Roles('TENANT_EDITOR')
@UseInterceptors(AuditInterceptor)
export class AdminReviewsController {
  constructor(private readonly reviews: AdminReviewsService) {}

  @Get()
  list(
    @CurrentTenant() tenant: CurrentTenantData,
    @Query('status') status?: ReviewStatus,
  ) {
    return this.reviews.list(tenant.id, status);
  }

  @Post(':id/approve')
  @HttpCode(200)
  approve(
    @CurrentTenant() tenant: CurrentTenantData,
    @Param('id') id: string,
    @Body() dto: ApproveReviewDto,
  ) {
    return this.reviews.approve(tenant.id, tenant.slug, id, dto);
  }

  @Post(':id/reject')
  @HttpCode(200)
  reject(
    @CurrentTenant() tenant: CurrentTenantData,
    @Param('id') id: string,
  ) {
    return this.reviews.reject(tenant.id, tenant.slug, id);
  }

  @Post(':id/reply')
  @HttpCode(200)
  reply(
    @CurrentTenant() tenant: CurrentTenantData,
    @Param('id') id: string,
    @Body() dto: ReplyReviewDto,
  ) {
    return this.reviews.reply(tenant.id, tenant.slug, id, dto);
  }
}
