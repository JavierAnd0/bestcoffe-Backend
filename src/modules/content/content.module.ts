import { Module } from '@nestjs/common';
import { ContentController } from './content.controller';
import { ContentService } from './content.service';
import { AdminContentController } from './admin-content.controller';
import { AdminContentService } from './admin-content.service';
import { AdminPagesController } from './admin-pages.controller';
import { AdminPagesService } from './admin-pages.service';

@Module({
  controllers: [
    ContentController,
    AdminContentController,
    AdminPagesController,
  ],
  providers: [ContentService, AdminContentService, AdminPagesService],
  exports: [ContentService],
})
export class ContentModule {}
