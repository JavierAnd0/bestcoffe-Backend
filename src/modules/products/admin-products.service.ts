import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProductStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RevalidationService } from '../revalidation/revalidation.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { CreateVariantDto } from './dto/create-variant.dto';
import { UpdateVariantDto } from './dto/update-variant.dto';
import { AttachImageDto, ReorderImagesDto } from './dto/images.dto';

const ADMIN_PRODUCT_INCLUDE = {
  images: { orderBy: { position: 'asc' as const } },
  variants: { orderBy: { sizeGrams: 'asc' as const } },
} satisfies Prisma.ProductInclude;

@Injectable()
export class AdminProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly revalidation: RevalidationService,
  ) {}

  /** Listado admin (incluye DRAFT/ARCHIVED), paginación keyset. */
  async list(tenantId: string, status?: ProductStatus, cursor?: string) {
    const items = await this.prisma.product.findMany({
      where: { tenantId, ...(status && { status }) },
      take: 26,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { variants: true } }, images: { take: 1, orderBy: { position: 'asc' } } },
    });
    const hasMore = items.length > 25;
    const page = hasMore ? items.slice(0, 25) : items;
    return { items: page, nextCursor: hasMore ? page[page.length - 1].id : null };
  }

  async findOne(tenantId: string, id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, tenantId },
      include: ADMIN_PRODUCT_INCLUDE,
    });
    if (!product) throw new NotFoundException('Producto no encontrado');
    return product;
  }

  async create(tenantId: string, tenantSlug: string, dto: CreateProductDto) {
    const slug = dto.slug ?? (await this.uniqueSlug(tenantId, dto.name));

    const product = await this.prisma.product.create({
      data: {
        tenantId,
        slug,
        name: dto.name,
        type: dto.type,
        origin: dto.origin,
        description: dto.description,
        producerStory: dto.producerStory,
        roastLevel: dto.roastLevel,
        flavorNotes: dto.flavorNotes ?? [],
        badges: dto.badges ?? [],
        status: dto.status ?? ProductStatus.DRAFT,
        ...(dto.subscriptionAvailability && {
          subscriptionAvailability: dto.subscriptionAvailability,
        }),
        ...(dto.variants?.length && {
          variants: {
            create: dto.variants.map((v) => ({
              tenantId,
              sizeGrams: v.sizeGrams,
              grind: v.grind,
              priceOneTime: v.priceOneTime,
              priceSubscription: v.priceSubscription,
              stock: v.stock ?? 0,
            })),
          },
        }),
      },
      include: ADMIN_PRODUCT_INCLUDE,
    });

    this.revalidate(tenantSlug, product.slug, product.status);
    return product;
  }

  async update(
    tenantId: string,
    tenantSlug: string,
    id: string,
    dto: UpdateProductDto,
  ) {
    await this.ensureProduct(tenantId, id);
    const product = await this.prisma.product.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.slug !== undefined && { slug: dto.slug }),
        ...(dto.type !== undefined && { type: dto.type }),
        ...(dto.origin !== undefined && { origin: dto.origin }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.producerStory !== undefined && {
          producerStory: dto.producerStory,
        }),
        ...(dto.roastLevel !== undefined && { roastLevel: dto.roastLevel }),
        ...(dto.flavorNotes !== undefined && { flavorNotes: dto.flavorNotes }),
        ...(dto.badges !== undefined && { badges: dto.badges }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.subscriptionAvailability !== undefined && {
          subscriptionAvailability: dto.subscriptionAvailability,
        }),
      },
      include: ADMIN_PRODUCT_INCLUDE,
    });

    this.revalidate(tenantSlug, product.slug, product.status);
    return product;
  }

  async archive(tenantId: string, tenantSlug: string, id: string) {
    const existing = await this.ensureProduct(tenantId, id);
    const product = await this.prisma.product.update({
      where: { id },
      data: { status: ProductStatus.ARCHIVED },
      select: { id: true, slug: true, status: true },
    });
    // siempre revalidar: el producto sale del storefront
    this.revalidation.dispatch(tenantSlug, ['products', `product:${existing.slug}`]);
    return product;
  }

  // ── Variantes ─────────────────────────────────────────────────────────────

  async addVariant(
    tenantId: string,
    tenantSlug: string,
    productId: string,
    dto: CreateVariantDto,
  ) {
    const product = await this.ensureProduct(tenantId, productId);
    const variant = await this.prisma.productVariant.create({
      data: {
        tenantId,
        productId,
        sizeGrams: dto.sizeGrams,
        grind: dto.grind,
        priceOneTime: dto.priceOneTime,
        priceSubscription: dto.priceSubscription,
        stock: dto.stock ?? 0,
      },
    });
    this.revalidation.dispatch(tenantSlug, [`product:${product.slug}`]);
    return variant;
  }

  async updateVariant(
    tenantId: string,
    tenantSlug: string,
    variantId: string,
    dto: UpdateVariantDto,
  ) {
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: variantId, tenantId },
      include: { product: { select: { slug: true } } },
    });
    if (!variant) throw new NotFoundException('Variante no encontrada');

    const updated = await this.prisma.productVariant.update({
      where: { id: variantId },
      data: {
        ...(dto.sizeGrams !== undefined && { sizeGrams: dto.sizeGrams }),
        ...(dto.grind !== undefined && { grind: dto.grind }),
        ...(dto.priceOneTime !== undefined && { priceOneTime: dto.priceOneTime }),
        ...(dto.priceSubscription !== undefined && {
          priceSubscription: dto.priceSubscription,
        }),
        ...(dto.stock !== undefined && { stock: dto.stock }),
      },
    });
    this.revalidation.dispatch(tenantSlug, [`product:${variant.product.slug}`]);
    return updated;
  }

  async removeVariant(tenantId: string, tenantSlug: string, variantId: string) {
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: variantId, tenantId },
      include: { product: { select: { slug: true } } },
    });
    if (!variant) throw new NotFoundException('Variante no encontrada');

    await this.prisma.productVariant.delete({ where: { id: variantId } });
    this.revalidation.dispatch(tenantSlug, [`product:${variant.product.slug}`]);
    return { id: variantId, deleted: true };
  }

  // ── Imágenes ──────────────────────────────────────────────────────────────

  async attachImage(
    tenantId: string,
    tenantSlug: string,
    productId: string,
    dto: AttachImageDto,
  ) {
    const product = await this.ensureProduct(tenantId, productId);
    const last = await this.prisma.productImage.aggregate({
      where: { productId },
      _max: { position: true },
    });
    const image = await this.prisma.productImage.create({
      data: {
        tenantId,
        productId,
        url: dto.url,
        alt: dto.alt,
        position: (last._max.position ?? -1) + 1,
      },
    });
    this.revalidation.dispatch(tenantSlug, [`product:${product.slug}`]);
    return image;
  }

  async reorderImages(
    tenantId: string,
    tenantSlug: string,
    productId: string,
    dto: ReorderImagesDto,
  ) {
    const product = await this.ensureProduct(tenantId, productId);
    const owned = await this.prisma.productImage.findMany({
      where: { productId, tenantId },
      select: { id: true },
    });
    const ownedIds = new Set(owned.map((i) => i.id));
    if (!dto.imageIds.every((id) => ownedIds.has(id))) {
      throw new NotFoundException('Alguna imagen no pertenece al producto');
    }

    await this.prisma.$transaction(
      dto.imageIds.map((id, position) =>
        this.prisma.productImage.update({ where: { id }, data: { position } }),
      ),
    );
    this.revalidation.dispatch(tenantSlug, [`product:${product.slug}`]);
    return { ok: true };
  }

  async removeImage(tenantId: string, tenantSlug: string, imageId: string) {
    const image = await this.prisma.productImage.findFirst({
      where: { id: imageId, tenantId },
      include: { product: { select: { slug: true } } },
    });
    if (!image) throw new NotFoundException('Imagen no encontrada');

    await this.prisma.productImage.delete({ where: { id: imageId } });
    this.revalidation.dispatch(tenantSlug, [`product:${image.product.slug}`]);
    return { id: imageId, deleted: true };
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async ensureProduct(tenantId: string, id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, tenantId },
      select: { id: true, slug: true },
    });
    if (!product) throw new NotFoundException('Producto no encontrado');
    return product;
  }

  /** Solo revalida si el producto está visible en el storefront. */
  private revalidate(tenantSlug: string, slug: string, status: ProductStatus) {
    if (status === ProductStatus.ACTIVE) {
      this.revalidation.dispatch(tenantSlug, ['products', `product:${slug}`]);
    }
  }

  private async uniqueSlug(tenantId: string, name: string): Promise<string> {
    const base = name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
    let slug = base || 'producto';
    let n = 1;
    while (
      await this.prisma.product.findUnique({
        where: { tenantId_slug: { tenantId, slug } },
        select: { id: true },
      })
    ) {
      slug = `${base}-${++n}`;
    }
    return slug;
  }
}
