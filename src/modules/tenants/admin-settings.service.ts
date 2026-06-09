import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RevalidationService } from '../revalidation/revalidation.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';

/** Claves de `features` controladas por la plataforma (plan/billing), no por el operador. */
const PLATFORM_FEATURE_KEYS = [
  'maxProducts',
  'customDomain',
  'giftSubscriptions',
];

@Injectable()
export class AdminSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly revalidation: RevalidationService,
  ) {}

  /** Configuración completa del tenant (incluye campos de solo lectura del plan). */
  async get(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        slug: true,
        name: true,
        tier: true,
        features: true,
        branding: true,
        updatedAt: true,
      },
    });
    if (!tenant) throw new NotFoundException('Tenant no encontrado');
    return tenant;
  }

  /**
   * Edita name/branding/envío. Preserva siempre las claves de plan dentro de
   * `features` (el operador no puede auto-otorgarse límites ni flags de plan).
   */
  async update(tenantId: string, tenantSlug: string, dto: UpdateSettingsDto) {
    const current = await this.get(tenantId);

    const data: Prisma.TenantUpdateInput = {};
    let touchesStorefront = false;

    if (dto.name !== undefined) {
      data.name = dto.name;
      touchesStorefront = true;
    }

    if (dto.branding) {
      const merged = {
        ...(current.branding as Record<string, unknown>),
        ...this.compact(dto.branding),
      };
      data.branding = merged as Prisma.InputJsonValue;
      touchesStorefront = true;
    }

    if (dto.shipping) {
      // merge sobre features existentes; las claves de plan quedan intactas
      // porque solo sobreescribimos las operativas que llegan en el DTO.
      const features = {
        ...(current.features as Record<string, unknown>),
        ...this.compact(dto.shipping),
      };
      data.features = features as Prisma.InputJsonValue;
    }

    const updated = await this.prisma.tenant.update({
      where: { id: tenantId },
      data,
      select: {
        id: true,
        slug: true,
        name: true,
        tier: true,
        features: true,
        branding: true,
        updatedAt: true,
      },
    });

    // branding/name afectan el shell cacheado del storefront
    if (touchesStorefront) {
      this.revalidation.dispatch(tenantSlug, ['settings']);
    }
    return updated;
  }

  /** Lista expuesta por si el front quiere saber qué claves son de plataforma. */
  get platformFeatureKeys() {
    return [...PLATFORM_FEATURE_KEYS];
  }

  /** Quita `undefined` para no escribir claves vacías en el JSON. */
  private compact(obj: object): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(obj).filter(([, v]) => v !== undefined),
    );
  }
}
