import { Module } from '@nestjs/common';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';
import { AdminSettingsController } from './admin-settings.controller';
import { AdminSettingsService } from './admin-settings.service';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';
import { AdminBillingController } from './admin-billing.controller';
import { AdminBillingService } from './admin-billing.service';

@Module({
  controllers: [
    TenantsController,
    AdminSettingsController,
    MembersController,
    AdminBillingController,
  ],
  providers: [
    TenantsService,
    AdminSettingsService,
    MembersService,
    AdminBillingService,
  ],
  exports: [TenantsService],
})
export class TenantsModule {}
