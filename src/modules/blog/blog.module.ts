import { Module } from '@nestjs/common';
import { BlogController } from './blog.controller';
import { BlogService } from './blog.service';
import { AdminBlogController } from './admin-blog.controller';
import { AdminBlogService } from './admin-blog.service';

@Module({
  controllers: [BlogController, AdminBlogController],
  providers: [BlogService, AdminBlogService],
  exports: [BlogService],
})
export class BlogModule {}
