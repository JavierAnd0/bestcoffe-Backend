import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../../common/guards/auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import type { CurrentTenantData } from '../../common/decorators/current-tenant.decorator';
import { AdminContentService } from './admin-content.service';
import { CreateContentDto } from './dto/create-content.dto';
import { UpdateContentDto } from './dto/update-content.dto';
import { ListContentDto } from './dto/list-content.dto';

@ApiTags('admin/content')
@ApiBearerAuth()
@Controller('v1/admin/content')
@UseGuards(AuthGuard, TenantGuard, RolesGuard)
@Roles('TENANT_EDITOR')
@UseInterceptors(AuditInterceptor)
export class AdminContentController {
  constructor(private readonly content: AdminContentService) {}

  @Get()
  list(
    @CurrentTenant() tenant: CurrentTenantData,
    @Query() query: ListContentDto,
  ) {
    return this.content.list(tenant.id, query);
  }

  @Get(':id')
  findOne(
    @CurrentTenant() tenant: CurrentTenantData,
    @Param('id') id: string,
  ) {
    return this.content.findOne(tenant.id, id);
  }

  @Post()
  create(
    @CurrentTenant() tenant: CurrentTenantData,
    @Body() dto: CreateContentDto,
  ) {
    return this.content.create(tenant.id, tenant.slug, dto);
  }

  @Patch(':id')
  update(
    @CurrentTenant() tenant: CurrentTenantData,
    @Param('id') id: string,
    @Body() dto: UpdateContentDto,
  ) {
    return this.content.update(tenant.id, tenant.slug, id, dto);
  }

  @Delete(':id')
  remove(
    @CurrentTenant() tenant: CurrentTenantData,
    @Param('id') id: string,
  ) {
    return this.content.remove(tenant.id, tenant.slug, id);
  }
}
