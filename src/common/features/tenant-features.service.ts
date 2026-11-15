import { Injectable, NotFoundException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { PrismaService } from '../../prisma/prisma.service';
import { CTX } from '../context/request-context';
import type { TenantBillingStatus } from '@prisma/client';
import {
  resolveFeatures,
  TIER_FEATURES,
  type FeatureFlags,
} from './tier-features';

/**
 * Estados de cobro en los que la tienda queda suspendida: no vende ni muestra
 * su sitio. PAST_DUE (pago vencido) NO suspende: solo avisa al operador.
 */
export function isSuspended(status: TenantBillingStatus): boolean {
  return status === 'CANCELLED' || status === 'INACTIVE';
}

/** Una tienda suspendida no tiene ninguna capacidad activa. */
function withoutCapabilities(flags: FeatureFlags): FeatureFlags {
  const out: Record<string, boolean | number> = { ...flags };
  for (const key of Object.keys(out)) {
    if (typeof out[key] === 'boolean') out[key] = false;
  }
  return out as FeatureFlags;
}

/**
 * Única puerta para preguntar "¿qué puede hacer esta tienda?". Resuelve las
 * capacidades efectivas (base del tier + overrides del tenant) con una caché
 * corta. Lo usan el FeatureGuard (bloqueo de endpoints) y los servicios cuyo
 * comportamiento cambia según el plan (catálogo, carrito, checkout).
 */
@Injectable()
export class TenantFeaturesService {
  private readonly cache = new Map<
    string,
    {
      flags: FeatureFlags;
      tier: string;
      suspended: boolean;
      sandbox: boolean;
      exp: number;
    }
  >();
  private static readonly TTL_MS = 30_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService,
  ) {}

  async get(tenantId: string): Promise<FeatureFlags> {
    return (await this.resolve(tenantId)).flags;
  }

  /** Capacidades + nombre del tier (para mensajes de "tu plan no lo incluye"). */
  async resolve(tenantId: string): Promise<{
    flags: FeatureFlags;
    tier: string;
    suspended: boolean;
    /** Tienda de demostración: acepta un estado de features por visitante. */
    sandbox: boolean;
  }> {
    const base = await this.resolveBase(tenantId);
    if (!base.sandbox || base.suspended) return base;
    return { ...base, flags: this.applyDemoOverride(base.flags) };
  }

  private async resolveBase(tenantId: string) {
    const now = Date.now();
    const cached = this.cache.get(tenantId);
    if (cached && cached.exp > now) return cached;

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { tier: true, features: true, billingStatus: true },
    });
    if (!tenant) throw new NotFoundException('Tenant no encontrado');

    const suspended = isSuspended(tenant.billingStatus);
    const flags = resolveFeatures(tenant.tier, tenant.features);
    const raw = tenant.features as Record<string, unknown> | null;
    const entry = {
      flags: suspended ? withoutCapabilities(flags) : flags,
      tier: tenant.tier,
      suspended,
      // Solo una tienda marcada a propósito como sandbox admite overrides por visitante.
      sandbox: raw?.demoSandbox === true,
      exp: now + TenantFeaturesService.TTL_MS,
    };
    this.cache.set(tenantId, entry);
    return entry;
  }

  /**
   * Estado de features elegido por el visitante en la tienda demo (cabecera
   * `X-Demo-Features`, JSON de booleanos). Solo toca capacidades booleanas
   * conocidas y NUNCA activa pagos en línea: la demo no cobra.
   */
  private applyDemoOverride(flags: FeatureFlags): FeatureFlags {
    // La demo no cobra: pagos en línea apagados siempre, con o sin override.
    const out: Record<string, boolean | number> = {
      ...flags,
      onlinePayments: false,
    };

    const raw = this.cls.get<string | undefined>(CTX.DEMO_FEATURES);
    if (!raw) return out as FeatureFlags;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return out as FeatureFlags;
    }
    if (!parsed || typeof parsed !== 'object') return out as FeatureFlags;

    for (const key of Object.keys(TIER_FEATURES.PRO)) {
      const value = (parsed as Record<string, unknown>)[key];
      if (typeof TIER_FEATURES.PRO[key as keyof FeatureFlags] === 'boolean') {
        if (typeof value === 'boolean' && key !== 'onlinePayments') {
          out[key] = value;
        }
      }
    }
    return out as FeatureFlags;
  }

  /** Invalida la caché tras cambiar el tier o los overrides de una tienda. */
  invalidate(tenantId: string): void {
    this.cache.delete(tenantId);
  }
}
