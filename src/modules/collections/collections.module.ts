import { Module } from '@nestjs/common';
import { CollectionsController } from './collections.controller';
import { CollectionsService } from './collections.service';
import { AdminCollectionsController } from './admin-collections.controller';
import { AdminCollectionsService } from './admin-collections.service';

@Module({
  controllers: [CollectionsController, AdminCollectionsController],
  providers: [CollectionsService, AdminCollectionsService],
  exports: [CollectionsService],
})
export class CollectionsModule {}
