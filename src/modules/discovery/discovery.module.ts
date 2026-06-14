import { Module } from '@nestjs/common';
import { BrewGuidesController } from './brew-guides.controller';
import { BrewGuidesService } from './brew-guides.service';
import { LocationsController } from './locations.controller';
import { LocationsService } from './locations.service';

@Module({
  controllers: [BrewGuidesController, LocationsController],
  providers: [BrewGuidesService, LocationsService],
})
export class DiscoveryModule {}
