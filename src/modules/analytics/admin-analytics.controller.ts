import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../../common/guards/auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { FeatureGuard } from '../../common/guards/feature.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequireFeature } from '../../common/decorators/require-feature.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import type { CurrentTenantData } from '../../common/decorators/current-tenant.decorator';
import { TenantFeaturesService } from '../../common/features/tenant-features.service';
import { AnalyticsRangeQuery, resolveRange } from './analytics-range';
import { AdminAnalyticsService } from './admin-analytics.service';

/**
 * Métricas del panel de la tienda. Lo básico exige `checkout` (una tienda
 * STARTER no vende, no hay qué medir); el plan de tueste y los clientes en
 * riesgo exigen `advancedAnalytics` (BUSINESS o cortesía por tenant).
 */
@ApiTags('admin/analytics')
@ApiBearerAuth()
@Controller('v1/admin/analytics')
@UseGuards(AuthGuard, TenantGuard, RolesGuard, FeatureGuard)
@Roles('TENANT_OWNER', 'TENANT_EDITOR')
export class AdminAnalyticsController {
  constructor(
    private readonly analytics: AdminAnalyticsService,
    private readonly features: TenantFeaturesService,
  ) {}

  @Get('sales')
  @RequireFeature('checkout')
  sales(
    @CurrentTenant() tenant: CurrentTenantData,
    @Query() q: AnalyticsRangeQuery,
  ) {
    return this.analytics.sales(tenant.id, resolveRange(q));
  }

  @Get('subscriptions')
  @RequireFeature('subscriptions')
  subscriptions(
    @CurrentTenant() tenant: CurrentTenantData,
    @Query() q: AnalyticsRangeQuery,
  ) {
    return this.analytics.subscriptions(tenant.id, resolveRange(q));
  }

  /** Lo usa también quien despacha: qué tostar esta semana y la próxima. */
  @Get('roast-plan')
  @RequireFeature('advancedAnalytics')
  @Roles('TENANT_OWNER', 'TENANT_EDITOR', 'TENANT_ORDERS')
  roastPlan(@CurrentTenant() tenant: CurrentTenantData) {
    return this.analytics.roastPlan(tenant.id);
  }

  @Get('products')
  @RequireFeature('checkout')
  products(
    @CurrentTenant() tenant: CurrentTenantData,
    @Query() q: AnalyticsRangeQuery,
  ) {
    return this.analytics.products(tenant.id, resolveRange(q));
  }

  @Get('customers')
  @RequireFeature('checkout')
  async customers(
    @CurrentTenant() tenant: CurrentTenantData,
    @Query() q: AnalyticsRangeQuery,
  ) {
    const { flags } = await this.features.resolve(tenant.id);
    return this.analytics.customers(tenant.id, resolveRange(q), {
      includeAtRisk: flags.advancedAnalytics,
    });
  }
}
