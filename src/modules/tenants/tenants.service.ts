import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { resolveFeatures } from '../../common/features/tier-features';

@Injectable()
export class TenantsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Datos públicos del tenant para que el front pinte branding/feature flags. */
  async getPublicProfile(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        slug: true,
        name: true,
        tier: true,
        features: true,
        branding: true,
        // Checkout: el storefront necesita saber qué pasarela usar y, para
        // MercadoPago, la public key del vendedor para tokenizar la tarjeta.
        paymentProvider: true,
        mpPublicKey: true,
      },
    });
    if (!tenant) throw new NotFoundException('Tenant no encontrado');

    // `features` resueltas = base del tier + overrides del tenant. El storefront
    // las usa para mostrar/ocultar carrito, login, suscripciones, etc.
    const { features: overrides, ...rest } = tenant;
    return { ...rest, features: resolveFeatures(tenant.tier, overrides) };
  }
}
