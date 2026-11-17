import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../../common/guards/auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { FeatureGuard } from '../../common/guards/feature.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequireFeature } from '../../common/decorators/require-feature.decorator';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import type { CurrentTenantData } from '../../common/decorators/current-tenant.decorator';
import { AdminBlogService } from './admin-blog.service';
import { CreateBlogPostDto, UpdateBlogPostDto } from './dto/save-blog-post.dto';

@ApiTags('admin/blog')
@ApiBearerAuth()
@Controller('v1/admin/blog')
@UseGuards(AuthGuard, TenantGuard, RolesGuard, FeatureGuard)
@RequireFeature('blog')
@Roles('TENANT_EDITOR')
@UseInterceptors(AuditInterceptor)
export class AdminBlogController {
  constructor(private readonly blog: AdminBlogService) {}

  @Get()
  @ApiOkResponse({ description: 'Todos los artículos, borradores incluidos' })
  list(@CurrentTenant() tenant: CurrentTenantData) {
    return this.blog.list(tenant.id);
  }

  @Get(':id')
  findOne(@CurrentTenant() tenant: CurrentTenantData, @Param('id') id: string) {
    return this.blog.findOne(tenant.id, id);
  }

  @Post()
  create(
    @CurrentTenant() tenant: CurrentTenantData,
    @Body() dto: CreateBlogPostDto,
  ) {
    return this.blog.create(tenant.id, tenant.slug, dto);
  }

  @Patch(':id')
  update(
    @CurrentTenant() tenant: CurrentTenantData,
    @Param('id') id: string,
    @Body() dto: UpdateBlogPostDto,
  ) {
    return this.blog.update(tenant.id, tenant.slug, id, dto);
  }

  @Post(':id/publish')
  @HttpCode(200)
  publish(@CurrentTenant() tenant: CurrentTenantData, @Param('id') id: string) {
    return this.blog.publish(tenant.id, tenant.slug, id);
  }

  @Post(':id/unpublish')
  @HttpCode(200)
  unpublish(
    @CurrentTenant() tenant: CurrentTenantData,
    @Param('id') id: string,
  ) {
    return this.blog.unpublish(tenant.id, tenant.slug, id);
  }

  @Delete(':id')
  remove(@CurrentTenant() tenant: CurrentTenantData, @Param('id') id: string) {
    return this.blog.remove(tenant.id, tenant.slug, id);
  }
}
