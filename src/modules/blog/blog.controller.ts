import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import type { CurrentTenantData } from '../../common/decorators/current-tenant.decorator';
import { BlogService } from './blog.service';
import { ListBlogDto } from './dto/list-blog.dto';

@ApiTags('blog')
@Controller('v1/blog')
@UseGuards(TenantGuard)
@Public()
export class BlogController {
  constructor(private readonly blog: BlogService) {}

  @Get()
  @ApiOkResponse({ description: 'Posts publicados, paginados' })
  list(
    @CurrentTenant() tenant: CurrentTenantData,
    @Query() query: ListBlogDto,
  ) {
    return this.blog.list(tenant.id, query);
  }

  @Get(':slug')
  @ApiOkResponse({ description: 'Detalle del post' })
  findOne(
    @CurrentTenant() tenant: CurrentTenantData,
    @Param('slug') slug: string,
  ) {
    return this.blog.findBySlug(tenant.id, slug);
  }
}
