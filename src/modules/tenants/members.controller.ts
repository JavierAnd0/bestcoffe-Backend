import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
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
import { MembersService } from './members.service';
import { AddMemberDto, UpdateMemberRoleDto } from './dto/member.dto';

@ApiTags('admin/members')
@ApiBearerAuth()
@Controller('v1/admin/members')
@UseGuards(AuthGuard, TenantGuard, RolesGuard)
@Roles('TENANT_OWNER')
@UseInterceptors(AuditInterceptor)
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  list(@CurrentTenant() tenant: CurrentTenantData) {
    return this.members.list(tenant.id);
  }

  @Post()
  add(
    @CurrentTenant() tenant: CurrentTenantData,
    @Body() dto: AddMemberDto,
  ) {
    return this.members.add(tenant.id, dto);
  }

  @Patch(':userId')
  updateRole(
    @CurrentTenant() tenant: CurrentTenantData,
    @Param('userId') userId: string,
    @Body() dto: UpdateMemberRoleDto,
  ) {
    return this.members.updateRole(tenant.id, userId, dto);
  }

  @Delete(':userId')
  remove(
    @CurrentTenant() tenant: CurrentTenantData,
    @Param('userId') userId: string,
  ) {
    return this.members.remove(tenant.id, userId);
  }
}
