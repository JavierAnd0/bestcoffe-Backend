import { Controller, Get, Param, UseGuards } from '@nestjs/common';
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

  @Get('pages/:slug')
  @ApiOkResponse({
    description:
      'Página editorial activa de la tienda (historia, impacto, sostenibilidad, mayoristas); 404 si está apagada o sin contenido',
  })
  page(
    @CurrentTenant() tenant: CurrentTenantData,
    @Param('slug') slug: string,
  ) {
    return this.content.getPage(tenant.id, slug);
  }
}
