import { Module } from '@nestjs/common';
import { AdminAnalyticsController } from './admin-analytics.controller';
import { AdminAnalyticsService } from './admin-analytics.service';
import { PlatformAnalyticsController } from './platform-analytics.controller';
import { PlatformAnalyticsService } from './platform-analytics.service';

@Module({
  controllers: [AdminAnalyticsController, PlatformAnalyticsController],
  providers: [AdminAnalyticsService, PlatformAnalyticsService],
})
export class AnalyticsModule {}
