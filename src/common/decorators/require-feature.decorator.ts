import { SetMetadata } from '@nestjs/common';
import type { BooleanFeatureKey } from '../features/tier-features';

export const REQUIRE_FEATURE_KEY = 'require_feature';

/**
 * Exige que el tenant actual tenga habilitada una capacidad según su tier.
 * El FeatureGuard la valida; si falta, responde 402 (Payment Required) con un
 * mensaje que indica el upgrade necesario.
 *
 *   @RequireFeature('checkout')
 *   @Post() create(...) { ... }
 */
export const RequireFeature = (feature: BooleanFeatureKey) =>
  SetMetadata(REQUIRE_FEATURE_KEY, feature);
