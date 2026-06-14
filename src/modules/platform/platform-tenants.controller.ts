import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PlatformGuard } from '../../common/guards/platform.guard';
import { PlatformTenantsService } from './platform-tenants.service';
import { CreatePlatformTenantDto } from './dto/create-platform-tenant.dto';
import { UpdatePlatformTenantDto } from './dto/update-platform-tenant.dto';

@ApiTags('platform')
@ApiBearerAuth()
@Controller('v1/platform/tenants')
@UseGuards(PlatformGuard)
export class PlatformTenantsController {
  constructor(private readonly tenants: PlatformTenantsService) {}

  @Get()
  list() {
    return this.tenants.list();
  }

  @Post()
  create(@Body() dto: CreatePlatformTenantDto) {
    return this.tenants.create(dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.tenants.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePlatformTenantDto) {
    return this.tenants.update(id, dto);
  }

  @Post(':id/impersonate')
  @HttpCode(200)
  impersonate(@Param('id') id: string) {
    return this.tenants.impersonate(id);
  }
}
