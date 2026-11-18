import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PlatformGuard } from '../../common/guards/platform.guard';
import { AnalyticsRangeQuery, resolveRange } from './analytics-range';
import { PlatformAnalyticsService } from './platform-analytics.service';

@ApiTags('platform/analytics')
@ApiBearerAuth()
@Controller('v1/platform/analytics')
@UseGuards(PlatformGuard)
export class PlatformAnalyticsController {
  constructor(private readonly analytics: PlatformAnalyticsService) {}

  /** MRR real, comisiones devengadas y pagos únicos. */
  @Get('revenue')
  revenue(@Query() q: AnalyticsRangeQuery) {
    return this.analytics.revenue(resolveRange(q));
  }

  /** Lo que venden todas las tiendas juntas. */
  @Get('gmv')
  gmv(@Query() q: AnalyticsRangeQuery) {
    return this.analytics.gmv(resolveRange(q));
  }

  /** Altas y cancelaciones de tiendas. */
  @Get('growth')
  growth(@Query() q: AnalyticsRangeQuery) {
    return this.analytics.growth(resolveRange(q));
  }

  /** Puntaje de salud por tienda, de peor a mejor. */
  @Get('health')
  health() {
    return this.analytics.health();
  }
}
