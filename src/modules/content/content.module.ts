import { Module } from '@nestjs/common';
import { ContentController } from './content.controller';
import { ContentService } from './content.service';
import { AdminContentController } from './admin-content.controller';
import { AdminContentService } from './admin-content.service';

@Module({
  controllers: [ContentController, AdminContentController],
  providers: [ContentService, AdminContentService],
  exports: [ContentService],
})
export class ContentModule {}
