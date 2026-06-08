import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import type { CurrentTenantData } from '../../common/decorators/current-tenant.decorator';
import { ContentService } from './content.service';

@ApiTags('content')
@Controller('v1/content')
@UseGuards(TenantGuard)
@Public()
export class ContentController {
  constructor(private readonly content: ContentService) {}

  @Get('home')
  @ApiOkResponse({ description: 'Contenido vigente para Home A' })
  home(@CurrentTenant() tenant: CurrentTenantData) {
    return this.content.getHomeContent(tenant.id);
  }
}
