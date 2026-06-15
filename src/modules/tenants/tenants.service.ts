import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

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
    return tenant;
  }
}
