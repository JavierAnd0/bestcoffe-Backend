import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../../common/guards/auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import type { CurrentTenantData } from '../../common/decorators/current-tenant.decorator';
import { EpaycoService } from './epayco.service';
import { SaveEpaycoKeysDto } from './dto/save-keys.dto';

@ApiTags('admin/epayco')
@ApiBearerAuth()
@Controller('v1/admin/epayco')
@UseGuards(AuthGuard, TenantGuard, RolesGuard)
@Roles('TENANT_OWNER')
export class EpaycoConnectController {
  constructor(private readonly epayco: EpaycoService) {}

  @Get('status')
  status(@CurrentTenant() tenant: CurrentTenantData) {
    return this.epayco.getConnectionStatus(tenant.id);
  }

  /** Guarda (o reemplaza) las llaves de ePayco de la tienda tras probarlas. */
  @Put('keys')
  saveKeys(
    @CurrentTenant() tenant: CurrentTenantData,
    @Body() dto: SaveEpaycoKeysDto,
  ) {
    return this.epayco.saveKeys(tenant.id, dto);
  }

  @Post('disconnect')
  @HttpCode(200)
  disconnect(@CurrentTenant() tenant: CurrentTenantData) {
    return this.epayco.disconnect(tenant.id);
  }
}
