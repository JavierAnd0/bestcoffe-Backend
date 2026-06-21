import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PlatformGuard } from '../../common/guards/platform.guard';
import { TIER_FEATURES } from '../../common/features/tier-features';

@ApiTags('platform')
@ApiBearerAuth()
@Controller('v1/platform/tiers')
@UseGuards(PlatformGuard)
export class PlatformTiersController {
  /**
   * Catálogo de capacidades por tier. La UI del super-admin lo usa para pintar
   * la tabla comparativa y saber qué activa cada plan al asignar el tier.
   */
  @Get()
  list() {
    return Object.entries(TIER_FEATURES).map(([tier, features]) => ({
      tier,
      features,
    }));
  }
}
