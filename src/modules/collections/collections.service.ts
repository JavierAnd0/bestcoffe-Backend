import { Injectable, NotFoundException } from '@nestjs/common';
import {
  CollectionType,
  Prisma,
  ProductStatus,
  SubAvail,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** Forma de las reglas AUTO almacenadas en Collection.rules (JSON). */
interface AutoRules {
  type?: Prisma.EnumProductTypeFilter['equals'];
  roastLevelGte?: number;
  roastLevelLte?: number;
  flavorNote?: string;
  badge?: string;
}

// Selección pública de producto reutilizada en catálogo/colecciones.
const PRODUCT_CARD_SELECT = {
  id: true,
  slug: true,
  name: true,
  type: true,
  origin: true,
  roastLevel: true,
  flavorNotes: true,
  badges: true,
  images: { orderBy: { position: 'asc' as const }, take: 1 },
  variants: {
    orderBy: { sizeGrams: 'asc' as const },
    select: {
      id: true,
      sizeGrams: true,
      grind: true,
      priceOneTime: true,
      priceSubscription: true,
      stock: true,
    },
  },
} satisfies Prisma.ProductSelect;

@Injectable()
export class CollectionsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Listado de colecciones del tenant (para nav/home), con conteo. */
  async list(tenantId: string) {
    const collections = await this.prisma.collection.findMany({
      where: { tenantId },
      orderBy: { position: 'asc' },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        type: true,
        _count: { select: { products: true } },
      },
    });
    return collections;
  }

  /** Detalle de colección con sus productos (resuelve MANUAL vs AUTO). */
  async findBySlug(tenantId: string, slug: string) {
    const collection = await this.prisma.collection.findUnique({
      where: { tenantId_slug: { tenantId, slug } },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        type: true,
        rules: true,
      },
    });
    if (!collection) {
      throw new NotFoundException(`Colección "${slug}" no encontrada`);
    }

    const products =
      collection.type === CollectionType.AUTO
        ? await this.resolveAuto(tenantId, collection.rules as AutoRules | null)
        : await this.resolveManual(collection.id);

    return { ...collection, rules: undefined, products };
  }

  /** Productos vinculados manualmente, respetando el orden definido. */
  private async resolveManual(collectionId: string) {
    const rows = await this.prisma.collectionProduct.findMany({
      where: {
        collectionId,
        product: { status: ProductStatus.ACTIVE },
      },
      orderBy: { position: 'asc' },
      select: { product: { select: PRODUCT_CARD_SELECT } },
    });
    return rows.map((r) => r.product);
  }

  /** Traduce las reglas AUTO a un where de Prisma. */
  private async resolveAuto(tenantId: string, rules: AutoRules | null) {
    const where: Prisma.ProductWhereInput = {
      tenantId,
      status: ProductStatus.ACTIVE,
      subscriptionAvailability: { not: SubAvail.SUBSCRIPTION_ONLY },
      ...(rules?.type && { type: rules.type }),
      ...(rules?.flavorNote && { flavorNotes: { has: rules.flavorNote } }),
      ...(rules?.badge && { badges: { has: rules.badge } }),
      ...((rules?.roastLevelGte || rules?.roastLevelLte) && {
        roastLevel: {
          ...(rules.roastLevelGte && { gte: rules.roastLevelGte }),
          ...(rules.roastLevelLte && { lte: rules.roastLevelLte }),
        },
      }),
    };
    return this.prisma.product.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 48,
      select: PRODUCT_CARD_SELECT,
    });
  }
}
