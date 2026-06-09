import { Module } from '@nestjs/common';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';
import { AdminSettingsController } from './admin-settings.controller';
import { AdminSettingsService } from './admin-settings.service';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';

@Module({
  controllers: [TenantsController, AdminSettingsController, MembersController],
  providers: [TenantsService, AdminSettingsService, MembersService],
  exports: [TenantsService],
})
export class TenantsModule {}
