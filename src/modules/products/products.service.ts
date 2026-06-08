import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ProductStatus, SubAvail } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ListProductsDto } from './dto/list-products.dto';

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Catálogo público: solo ACTIVE, scope por tenant, paginación keyset. */
  async list(tenantId: string, query: ListProductsDto) {
    const limit = query.limit ?? 24;

    const where: Prisma.ProductWhereInput = {
      tenantId,
      status: ProductStatus.ACTIVE,
      // SUBSCRIPTION_ONLY no aparece en el catálogo regular
      subscriptionAvailability: { not: SubAvail.SUBSCRIPTION_ONLY },
      ...(query.type && { type: query.type }),
      ...(query.roastMin && { roastLevel: { gte: query.roastMin } }),
      ...(query.flavorNote && { flavorNotes: { has: query.flavorNote } }),
      ...(query.collection && {
        collections: { some: { collection: { slug: query.collection } } },
      }),
    };

    const items = await this.prisma.product.findMany({
      where,
      take: limit + 1,
      ...(query.cursor && { cursor: { id: query.cursor }, skip: 1 }),
      orderBy: { createdAt: 'desc' },
      include: {
        images: { orderBy: { position: 'asc' }, take: 1 },
        variants: {
          orderBy: { sizeGrams: 'asc' },
          select: {
            id: true,
            sizeGrams: true,
            grind: true,
            priceOneTime: true,
            priceSubscription: true,
            stock: true,
          },
        },
      },
    });

    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;

    return {
      items: page,
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  /** Detalle público por slug con reseñas aprobadas. */
  async findBySlug(tenantId: string, slug: string) {
    const product = await this.prisma.product.findFirst({
      where: { tenantId, slug, status: ProductStatus.ACTIVE },
      include: {
        images: { orderBy: { position: 'asc' } },
        variants: { orderBy: { sizeGrams: 'asc' } },
        reviews: {
          where: { status: 'APPROVED' },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            rating: true,
            title: true,
            body: true,
            reply: true,
            verifiedSubscriber: true,
            createdAt: true,
          },
        },
      },
    });

    if (!product) {
      throw new NotFoundException(`Producto "${slug}" no encontrado`);
    }
    return product;
  }
}
