import { BadRequestException, Injectable } from '@nestjs/common';
import { DiscountType, SubAvail } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PriceCartDto, PurchaseMode } from './dto/price-cart.dto';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';
import { MergeCartDto } from './dto/merge-cart.dto';
import { CustomerCartResponseDto } from './dto/customer-cart-response.dto';
import {
  CartDiscountDto,
  CartLineDto,
  CartPriceResponseDto,
} from './dto/cart-price-response.dto';

// Defaults de envío (centavos COP). Sobreescribibles vía Tenant.features.
const DEFAULT_FREE_SHIPPING_THRESHOLD = 150_000 * 100;
const DEFAULT_SHIPPING_FLAT = 12_000 * 100;

@Injectable()
export class CartService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Calcula el carrito del lado servidor (precio autoritativo). Valida que las
   * variantes pertenezcan al tenant y estén activas, marca faltas de stock,
   * valida el código de descuento y aplica el umbral de envío gratis.
   */
  async price(
    tenantId: string,
    dto: PriceCartDto,
    customerId?: string,
  ): Promise<CartPriceResponseDto> {
    const mode = dto.mode ?? PurchaseMode.ONE_TIME;
    const ids = [...new Set(dto.items.map((i) => i.variantId))];

    const variants = await this.prisma.productVariant.findMany({
      where: { tenantId, id: { in: ids }, product: { status: 'ACTIVE' } },
      select: {
        id: true,
        sizeGrams: true,
        grind: true,
        priceOneTime: true,
        priceSubscription: true,
        stock: true,
        product: {
          select: { slug: true, name: true, subscriptionAvailability: true },
        },
      },
    });
    const byId = new Map(variants.map((v) => [v.id, v]));

    const lines: CartLineDto[] = [];
    let subtotalCents = 0;
    let hasStockIssues = false;

    for (const item of dto.items) {
      const v = byId.get(item.variantId);
      if (!v) {
        throw new BadRequestException(
          `Variante ${item.variantId} no disponible`,
        );
      }

      if (
        mode === PurchaseMode.ONE_TIME &&
        v.product.subscriptionAvailability === SubAvail.SUBSCRIPTION_ONLY
      ) {
        throw new BadRequestException(
          `"${v.product.name}" es solo por suscripción`,
        );
      }

      const unitCents =
        mode === PurchaseMode.SUBSCRIPTION
          ? (v.priceSubscription ?? v.priceOneTime)
          : v.priceOneTime;
      const lineCents = unitCents * item.quantity;
      const outOfStock = v.stock < item.quantity;
      if (outOfStock) hasStockIssues = true;

      subtotalCents += lineCents;
      lines.push({
        variantId: v.id,
        productSlug: v.product.slug,
        productName: v.product.name,
        sizeGrams: v.sizeGrams,
        grind: v.grind,
        unitCents,
        quantity: item.quantity,
        lineCents,
        outOfStock,
      });
    }

    const discount = dto.discountCode
      ? await this.validateDiscount(
          tenantId,
          dto.discountCode,
          subtotalCents,
          customerId,
        )
      : undefined;
    const discountCents = discount?.valid ? discount.amountCents : 0;

    const shippingCents = await this.shippingFor(tenantId, subtotalCents);
    const totalCents = Math.max(
      0,
      subtotalCents - discountCents + shippingCents,
    );

    return {
      lines,
      subtotalCents,
      discountCents,
      shippingCents,
      totalCents,
      hasStockIssues,
      discount,
    };
  }

  // ─── Carrito Persistente en Base de Datos (Usuarios Autenticados) ─────────────

  /**
   * Obtiene el carrito del cliente en base de datos junto con el cálculo de precios.
   */
  async getCart(
    tenantId: string,
    customerId: string,
    discountCode?: string,
  ): Promise<CustomerCartResponseDto> {
    const rawItems = await this.prisma.cartItem.findMany({
      where: { tenantId, customerId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        variantId: true,
        quantity: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (rawItems.length === 0) {
      return {
        rawItems: [],
        lines: [],
        subtotalCents: 0,
        discountCents: 0,
        shippingCents: 0,
        totalCents: 0,
        hasStockIssues: false,
      };
    }

    const priceResult = await this.price(
      tenantId,
      {
        items: rawItems.map((i) => ({
          variantId: i.variantId,
          quantity: i.quantity,
        })),
        discountCode,
      },
      customerId,
    );

    return {
      ...priceResult,
      rawItems,
    };
  }

  /**
   * Agrega o incrementa un item en el carrito persistente del cliente.
   */
  async addItem(
    tenantId: string,
    customerId: string,
    dto: AddCartItemDto,
  ): Promise<CustomerCartResponseDto> {
    const variant = await this.prisma.productVariant.findFirst({
      where: {
        id: dto.variantId,
        tenantId,
        product: { status: 'ACTIVE' },
      },
      select: { id: true },
    });

    if (!variant) {
      throw new BadRequestException(
        'La variante de producto no está disponible',
      );
    }

    const existing = await this.prisma.cartItem.findUnique({
      where: {
        customerId_variantId: {
          customerId,
          variantId: dto.variantId,
        },
      },
    });

    if (existing) {
      const newQuantity = Math.min(99, existing.quantity + dto.quantity);
      await this.prisma.cartItem.update({
        where: { id: existing.id },
        data: { quantity: newQuantity },
      });
    } else {
      await this.prisma.cartItem.create({
        data: {
          tenantId,
          customerId,
          variantId: dto.variantId,
          quantity: Math.min(99, dto.quantity),
        },
      });
    }

    return this.getCart(tenantId, customerId);
  }

  /**
   * Actualiza la cantidad de un item en el carrito (o lo elimina si quantity <= 0).
   */
  async updateItem(
    tenantId: string,
    customerId: string,
    variantId: string,
    dto: UpdateCartItemDto,
  ): Promise<CustomerCartResponseDto> {
    if (dto.quantity <= 0) {
      return this.removeItem(tenantId, customerId, variantId);
    }

    await this.prisma.cartItem.updateMany({
      where: { tenantId, customerId, variantId },
      data: { quantity: Math.min(99, dto.quantity) },
    });

    return this.getCart(tenantId, customerId);
  }

  /**
   * Elimina un item específico del carrito persistente.
   */
  async removeItem(
    tenantId: string,
    customerId: string,
    variantId: string,
  ): Promise<CustomerCartResponseDto> {
    await this.prisma.cartItem.deleteMany({
      where: { tenantId, customerId, variantId },
    });

    return this.getCart(tenantId, customerId);
  }

  /**
   * Vacía completamente el carrito en base de datos.
   */
  async clearCart(
    tenantId: string,
    customerId: string,
  ): Promise<{ message: string }> {
    await this.prisma.cartItem.deleteMany({
      where: { tenantId, customerId },
    });

    return { message: 'Carrito vaciado exitosamente' };
  }

  /**
   * Fusiona los items de localStorage con el carrito en base de datos al iniciar sesión.
   */
  async mergeCart(
    tenantId: string,
    customerId: string,
    dto: MergeCartDto,
  ): Promise<CustomerCartResponseDto> {
    if (!dto.items || dto.items.length === 0) {
      return this.getCart(tenantId, customerId);
    }

    const variantIds = [...new Set(dto.items.map((i) => i.variantId))];
    const validVariants = await this.prisma.productVariant.findMany({
      where: {
        id: { in: variantIds },
        tenantId,
        product: { status: 'ACTIVE' },
      },
      select: { id: true },
    });
    const validSet = new Set(validVariants.map((v) => v.id));

    for (const item of dto.items) {
      if (!validSet.has(item.variantId)) continue;

      const existing = await this.prisma.cartItem.findUnique({
        where: {
          customerId_variantId: {
            customerId,
            variantId: item.variantId,
          },
        },
      });

      if (existing) {
        await this.prisma.cartItem.update({
          where: { id: existing.id },
          data: { quantity: Math.min(99, existing.quantity + item.quantity) },
        });
      } else {
        await this.prisma.cartItem.create({
          data: {
            tenantId,
            customerId,
            variantId: item.variantId,
            quantity: Math.min(99, item.quantity),
          },
        });
      }
    }

    return this.getCart(tenantId, customerId);
  }

  /** Valida vigencia/condiciones del código y calcula el descuento (no lo redime). */
  private async validateDiscount(
    tenantId: string,
    code: string,
    subtotalCents: number,
    customerId?: string,
  ): Promise<CartDiscountDto> {
    const dc = await this.prisma.discountCode.findUnique({
      where: { tenantId_code: { tenantId, code: code.toUpperCase() } },
    });
    const invalid = (reason: string): CartDiscountDto => ({
      code,
      valid: false,
      amountCents: 0,
      reason,
    });

    const now = new Date();
    if (!dc || !dc.active) return invalid('Código inválido');
    if (dc.startsAt && dc.startsAt > now) return invalid('Aún no vigente');
    if (dc.endsAt && dc.endsAt < now) return invalid('Código expirado');
    if (dc.maxRedemptions && dc.timesRedeemed >= dc.maxRedemptions) {
      return invalid('Código agotado');
    }
    if (dc.minSubtotalCents && subtotalCents < dc.minSubtotalCents) {
      return invalid('No alcanza el mínimo de compra');
    }

    if (dc.oneUsePerCustomer) {
      if (!customerId) {
        return invalid('Inicia sesión para usar este cupón de un solo uso');
      }
      const previousUse = await this.prisma.order.findFirst({
        where: {
          tenantId,
          customerId,
          discountCode: dc.code,
          paymentStatus: 'PAID',
        },
        select: { id: true },
      });
      if (previousUse) {
        return invalid('Ya has utilizado este código de descuento');
      }
    }

    const amountCents =
      dc.type === DiscountType.PERCENTAGE
        ? Math.round((subtotalCents * dc.value) / 100)
        : Math.min(dc.value, subtotalCents);

    return { code: dc.code, valid: true, amountCents };
  }

  private async shippingFor(
    tenantId: string,
    subtotalCents: number,
  ): Promise<number> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { features: true },
    });
    const features = (tenant?.features ?? {}) as Record<string, unknown>;
    const threshold =
      (features.freeShippingThresholdCents as number) ??
      DEFAULT_FREE_SHIPPING_THRESHOLD;
    const flat =
      (features.shippingFlatCents as number) ?? DEFAULT_SHIPPING_FLAT;
    return subtotalCents >= threshold ? 0 : flat;
  }
}
