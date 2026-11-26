import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProductStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { resolveFeatures } from '../../common/features/tier-features';
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
      include: {
        _count: { select: { variants: true } },
        images: { take: 1, orderBy: { position: 'asc' } },
      },
    });
    const hasMore = items.length > 25;
    const page = hasMore ? items.slice(0, 25) : items;
    return {
      items: page,
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
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
    for (const v of dto.variants ?? []) {
      assertCompareAt(v.priceOneTime, v.compareAtPrice);
    }
    await this.assertProductQuota(tenantId);
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
              compareAtPrice: v.compareAtPrice ?? null,
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
    this.revalidation.dispatch(tenantSlug, [
      'products',
      `product:${existing.slug}`,
    ]);
    return product;
  }

  // ── Variantes ─────────────────────────────────────────────────────────────

  async addVariant(
    tenantId: string,
    tenantSlug: string,
    productId: string,
    dto: CreateVariantDto,
  ) {
    assertCompareAt(dto.priceOneTime, dto.compareAtPrice);
    const product = await this.ensureProduct(tenantId, productId);
    const variant = await this.prisma.productVariant.create({
      data: {
        tenantId,
        productId,
        sizeGrams: dto.sizeGrams,
        grind: dto.grind,
        priceOneTime: dto.priceOneTime,
        priceSubscription: dto.priceSubscription,
        compareAtPrice: dto.compareAtPrice ?? null,
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
    // Se valida contra el resultado final: el cambio puede tocar solo uno de los dos precios.
    assertCompareAt(
      dto.priceOneTime ?? variant.priceOneTime,
      dto.compareAtPrice !== undefined
        ? dto.compareAtPrice
        : variant.compareAtPrice,
    );

    const updated = await this.prisma.productVariant.update({
      where: { id: variantId },
      data: {
        ...(dto.sizeGrams !== undefined && { sizeGrams: dto.sizeGrams }),
        ...(dto.grind !== undefined && { grind: dto.grind }),
        ...(dto.priceOneTime !== undefined && {
          priceOneTime: dto.priceOneTime,
        }),
        ...(dto.priceSubscription !== undefined && {
          priceSubscription: dto.priceSubscription,
        }),
        ...(dto.compareAtPrice !== undefined && {
          compareAtPrice: dto.compareAtPrice,
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

    // Las suscripciones y los regalos apuntan a la variante (sin borrado en
    // cascada, para no perder historial): se explica en vez de fallar en la base.
    const [liveSubs, pastSubs, gifts] = await Promise.all([
      this.prisma.subscription.count({
        where: { variantId, tenantId, status: { not: 'CANCELLED' } },
      }),
      this.prisma.subscription.count({
        where: { variantId, tenantId, status: 'CANCELLED' },
      }),
      this.prisma.giftSubscription.count({ where: { variantId, tenantId } }),
    ]);
    if (liveSubs > 0) {
      throw new ConflictException(
        `Tiene ${liveSubs} suscripción(es) vigente(s). Cancélalas antes de eliminarla, ` +
          'o deja su stock en 0 para que no se pueda comprar.',
      );
    }
    if (pastSubs > 0 || gifts > 0) {
      throw new ConflictException(
        'Tiene historial de suscripciones o regalos y no se puede eliminar. ' +
          'Deja su stock en 0 y quita su precio de suscripción para que no se pueda comprar.',
      );
    }

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
    assertOwnBlobImage(dto.url, tenantSlug);
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
    // La URL sale de la base (no del cliente): el front borra el archivo solo
    // si el backend confirmó que la imagen era de esta tienda.
    return { id: imageId, deleted: true, url: image.url };
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

  /**
   * Aplica el límite de productos del tier (maxProducts; -1 = ilimitado).
   * Responde 402 si el tenant llegó al tope de su plan.
   */
  private async assertProductQuota(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { tier: true, features: true },
    });
    if (!tenant) throw new NotFoundException('Tenant no encontrado');

    const { maxProducts } = resolveFeatures(tenant.tier, tenant.features);
    if (maxProducts < 0) return; // ilimitado

    const count = await this.prisma.product.count({ where: { tenantId } });
    if (count >= maxProducts) {
      throw new HttpException(
        {
          statusCode: HttpStatus.PAYMENT_REQUIRED,
          error: 'Límite de productos alcanzado',
          message: `Tu plan (${tenant.tier}) permite hasta ${maxProducts} productos. Sube de plan para agregar más.`,
          feature: 'maxProducts',
          currentTier: tenant.tier,
          limit: maxProducts,
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
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

/**
 * Una imagen alojada en el Vercel Blob de la plataforma solo se acepta si está
 * en la carpeta de esta tienda (`products/<slug>/`, donde sube el panel).
 * Sin esto, una tienda podía adjuntar la URL de una imagen de otra y, al
 * quitarla, el panel borraba el archivo ajeno. Las URLs externas (otro host)
 * se siguen aceptando como antes.
 */
export function assertOwnBlobImage(url: string, tenantSlug: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return; // el DTO ya exige una URL válida
  }
  if (!parsed.hostname.endsWith('.blob.vercel-storage.com')) return;
  let path: string;
  try {
    path = decodeURIComponent(parsed.pathname);
  } catch {
    throw new BadRequestException('La URL de la imagen no es válida');
  }
  if (path.includes('..') || !path.startsWith(`/products/${tenantSlug}/`)) {
    throw new BadRequestException(
      'La imagen debe subirse desde el panel de esta tienda',
    );
  }
}

/** El precio anterior (tachado) solo tiene sentido si es mayor que el que se cobra. */
function assertCompareAt(
  price: number,
  compareAt: number | null | undefined,
): void {
  if (compareAt != null && compareAt <= price) {
    throw new BadRequestException(
      'El precio anterior debe ser mayor que el precio actual.',
    );
  }
}
