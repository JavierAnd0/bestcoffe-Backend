import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CollectionType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RevalidationService } from '../revalidation/revalidation.service';
import { CreateCollectionDto } from './dto/create-collection.dto';
import { UpdateCollectionDto } from './dto/update-collection.dto';
import {
  AttachProductsDto,
  ReorderProductsDto,
} from './dto/collection-products.dto';

@Injectable()
export class AdminCollectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly revalidation: RevalidationService,
  ) {}

  /** Listado admin de colecciones con conteo de productos vinculados. */
  async list(tenantId: string) {
    return this.prisma.collection.findMany({
      where: { tenantId },
      orderBy: { position: 'asc' },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        type: true,
        position: true,
        rules: true,
        _count: { select: { products: true } },
      },
    });
  }

  /** Detalle con los productos vinculados manualmente (en orden). */
  async findOne(tenantId: string, id: string) {
    const collection = await this.prisma.collection.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        type: true,
        position: true,
        rules: true,
        products: {
          orderBy: { position: 'asc' },
          select: {
            position: true,
            product: { select: { id: true, slug: true, name: true, status: true } },
          },
        },
      },
    });
    if (!collection) throw new NotFoundException('Colección no encontrada');
    return collection;
  }

  async create(tenantId: string, tenantSlug: string, dto: CreateCollectionDto) {
    const slug = dto.slug
      ? await this.assertSlugFree(tenantId, dto.slug)
      : await this.uniqueSlug(tenantId, dto.name);

    const collection = await this.prisma.collection.create({
      data: {
        tenantId,
        slug,
        name: dto.name,
        description: dto.description,
        type: dto.type ?? CollectionType.MANUAL,
        ...(dto.rules && { rules: dto.rules as Prisma.InputJsonValue }),
        position: dto.position ?? 0,
      },
    });
    this.revalidation.dispatch(tenantSlug, ['collections']);
    return collection;
  }

  async update(
    tenantId: string,
    tenantSlug: string,
    id: string,
    dto: UpdateCollectionDto,
  ) {
    const existing = await this.ensure(tenantId, id);
    if (dto.slug && dto.slug !== existing.slug) {
      await this.assertSlugFree(tenantId, dto.slug);
    }

    const updated = await this.prisma.collection.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.slug !== undefined && { slug: dto.slug }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.type !== undefined && { type: dto.type }),
        ...(dto.rules !== undefined && { rules: dto.rules as Prisma.InputJsonValue }),
        ...(dto.position !== undefined && { position: dto.position }),
      },
    });
    this.revalidate(tenantSlug, [existing.slug, updated.slug]);
    return updated;
  }

  async remove(tenantId: string, tenantSlug: string, id: string) {
    const collection = await this.ensure(tenantId, id);
    await this.prisma.collection.delete({ where: { id } });
    this.revalidate(tenantSlug, [collection.slug]);
    return { id, deleted: true };
  }

  // ── Productos (solo colecciones MANUAL) ─────────────────────────────────────

  async attachProducts(
    tenantId: string,
    tenantSlug: string,
    id: string,
    dto: AttachProductsDto,
  ) {
    const collection = await this.ensureManual(tenantId, id);
    await this.assertProductsOwned(tenantId, dto.productIds);

    const last = await this.prisma.collectionProduct.aggregate({
      where: { collectionId: id },
      _max: { position: true },
    });
    let position = (last._max.position ?? -1) + 1;

    // idempotente: ignora los que ya estén vinculados
    await this.prisma.$transaction(
      dto.productIds.map((productId) =>
        this.prisma.collectionProduct.upsert({
          where: { collectionId_productId: { collectionId: id, productId } },
          update: {},
          create: { collectionId: id, productId, position: position++ },
        }),
      ),
    );
    this.revalidate(tenantSlug, [collection.slug]);
    return this.findOne(tenantId, id);
  }

  async reorderProducts(
    tenantId: string,
    tenantSlug: string,
    id: string,
    dto: ReorderProductsDto,
  ) {
    const collection = await this.ensureManual(tenantId, id);
    const linked = await this.prisma.collectionProduct.findMany({
      where: { collectionId: id },
      select: { productId: true },
    });
    const linkedIds = new Set(linked.map((l) => l.productId));
    if (
      dto.productIds.length !== linkedIds.size ||
      !dto.productIds.every((pid) => linkedIds.has(pid))
    ) {
      throw new BadRequestException(
        'La lista debe contener exactamente los productos vinculados',
      );
    }

    await this.prisma.$transaction(
      dto.productIds.map((productId, position) =>
        this.prisma.collectionProduct.update({
          where: { collectionId_productId: { collectionId: id, productId } },
          data: { position },
        }),
      ),
    );
    this.revalidate(tenantSlug, [collection.slug]);
    return this.findOne(tenantId, id);
  }

  async detachProduct(
    tenantId: string,
    tenantSlug: string,
    id: string,
    productId: string,
  ) {
    const collection = await this.ensureManual(tenantId, id);
    const link = await this.prisma.collectionProduct.findUnique({
      where: { collectionId_productId: { collectionId: id, productId } },
      select: { productId: true },
    });
    if (!link) throw new NotFoundException('El producto no está en la colección');

    await this.prisma.collectionProduct.delete({
      where: { collectionId_productId: { collectionId: id, productId } },
    });
    this.revalidate(tenantSlug, [collection.slug]);
    return { collectionId: id, productId, detached: true };
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private async ensure(tenantId: string, id: string) {
    const collection = await this.prisma.collection.findFirst({
      where: { id, tenantId },
      select: { id: true, slug: true, type: true },
    });
    if (!collection) throw new NotFoundException('Colección no encontrada');
    return collection;
  }

  private async ensureManual(tenantId: string, id: string) {
    const collection = await this.ensure(tenantId, id);
    if (collection.type !== CollectionType.MANUAL) {
      throw new BadRequestException(
        'Solo las colecciones MANUAL gestionan productos a mano; las AUTO usan reglas',
      );
    }
    return collection;
  }

  private async assertProductsOwned(tenantId: string, productIds: string[]) {
    const count = await this.prisma.product.count({
      where: { tenantId, id: { in: productIds } },
    });
    if (count !== new Set(productIds).size) {
      throw new NotFoundException('Algún producto no existe en este tenant');
    }
  }

  private async assertSlugFree(tenantId: string, slug: string): Promise<string> {
    const clash = await this.prisma.collection.findUnique({
      where: { tenantId_slug: { tenantId, slug } },
      select: { id: true },
    });
    if (clash) throw new BadRequestException(`El slug "${slug}" ya está en uso`);
    return slug;
  }

  private revalidate(tenantSlug: string, slugs: string[]) {
    const tags = [
      'collections',
      ...new Set(slugs.map((s) => `collection:${s}`)),
    ];
    this.revalidation.dispatch(tenantSlug, tags);
  }

  private async uniqueSlug(tenantId: string, name: string): Promise<string> {
    const base =
      name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '') || 'coleccion';
    let slug = base;
    let n = 1;
    while (
      await this.prisma.collection.findUnique({
        where: { tenantId_slug: { tenantId, slug } },
        select: { id: true },
      })
    ) {
      slug = `${base}-${++n}`;
    }
    return slug;
  }
}
