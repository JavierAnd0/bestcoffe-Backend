import { Module } from '@nestjs/common';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';
import { AdminSettingsController } from './admin-settings.controller';
import { AdminSettingsService } from './admin-settings.service';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';
import { AdminBillingController } from './admin-billing.controller';
import { AdminBillingService } from './admin-billing.service';
import { TenantDomainsController } from './tenant-domains.controller';
import { TenantDomainsService } from './tenant-domains.service';

@Module({
  controllers: [
    TenantsController,
    AdminSettingsController,
    MembersController,
    AdminBillingController,
    TenantDomainsController,
  ],
  providers: [
    TenantsService,
    AdminSettingsService,
    MembersService,
    AdminBillingService,
    TenantDomainsService,
  ],
  exports: [TenantsService, TenantDomainsService],
})
export class TenantsModule {}
