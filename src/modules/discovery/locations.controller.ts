import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import type { CurrentTenantData } from '../../common/decorators/current-tenant.decorator';
import { LocationsService } from './locations.service';

@ApiTags('locations')
@Controller('v1/locations')
@UseGuards(TenantGuard)
@Public()
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Get()
  list(@CurrentTenant() tenant: CurrentTenantData) {
    return this.locations.list(tenant.id);
  }
}
