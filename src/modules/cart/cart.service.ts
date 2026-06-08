import { BadRequestException, Injectable } from '@nestjs/common';
import { DiscountType, SubAvail } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PriceCartDto, PurchaseMode } from './dto/price-cart.dto';
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
  async price(tenantId: string, dto: PriceCartDto): Promise<CartPriceResponseDto> {
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
          ? v.priceSubscription ?? v.priceOneTime
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
      ? await this.validateDiscount(tenantId, dto.discountCode, subtotalCents)
      : undefined;
    const discountCents = discount?.valid ? discount.amountCents : 0;

    const shippingCents = await this.shippingFor(tenantId, subtotalCents);
    const totalCents = Math.max(0, subtotalCents - discountCents + shippingCents);

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

  /** Valida vigencia/condiciones del código y calcula el descuento (no lo redime). */
  private async validateDiscount(
    tenantId: string,
    code: string,
    subtotalCents: number,
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
