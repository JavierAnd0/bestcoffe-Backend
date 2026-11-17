import { Module } from '@nestjs/common';
import { BrewGuidesController } from './brew-guides.controller';
import { BrewGuidesService } from './brew-guides.service';
import { LocationsController } from './locations.controller';
import { LocationsService } from './locations.service';
import { AdminBrewGuidesController } from './admin-brew-guides.controller';
import { AdminBrewGuidesService } from './admin-brew-guides.service';
import { AdminLocationsController } from './admin-locations.controller';
import { AdminLocationsService } from './admin-locations.service';

@Module({
  controllers: [
    BrewGuidesController,
    LocationsController,
    AdminBrewGuidesController,
    AdminLocationsController,
  ],
  providers: [
    BrewGuidesService,
    LocationsService,
    AdminBrewGuidesService,
    AdminLocationsService,
  ],
})
export class DiscoveryModule {}
