import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CartService } from '../cart/cart.service';
import { StripeService } from '../stripe/stripe.service';
import type { CreateOrderDto } from './dto/create-order.dto';

@Injectable()
export class CheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cart: CartService,
    private readonly stripe: StripeService,
  ) {}

  async create(tenantId: string, customerId: string, dto: CreateOrderDto) {
    // 1. Precio autoritativo — valida variantes, stock, descuento, envío.
    const priced = await this.cart.price(tenantId, {
      items: dto.items,
      mode: dto.mode,
      discountCode: dto.discountCode,
    });

    if (priced.hasStockIssues) {
      const outOfStock = priced.lines
        .filter((l) => l.outOfStock)
        .map((l) => l.productName)
        .join(', ');
      throw new BadRequestException(
        `Stock insuficiente: ${outOfStock}`,
      );
    }

    // 2. Crear la orden en estado PENDING dentro de una transacción.
    const order = await this.prisma.$transaction(async (tx) => {
      return tx.order.create({
        data: {
          tenantId,
          customerId,
          source: 'CHECKOUT',
          status: 'RECEIVED',
          paymentStatus: 'PENDING',
          shippingAddress: dto.shippingAddress as object,
          subtotalCents: priced.subtotalCents,
          discountCents: priced.discountCents,
          shippingCents: priced.shippingCents,
          totalCents: priced.totalCents,
          discountCode: priced.discount?.valid ? priced.discount.code : undefined,
          items: {
            create: priced.lines.map((line) => ({
              tenantId,
              variantId: line.variantId,
              productName: line.productName,
              variantName: `${line.sizeGrams}g · ${line.grind}`,
              grind: line.grind,
              sizeGrams: line.sizeGrams,
              unitCents: line.unitCents,
              quantity: line.quantity,
              lineCents: line.lineCents,
            })),
          },
        },
      });
    });

    // 3. Crear PaymentIntent en Stripe.
    const { clientSecret, piId } = await this.stripe.createPaymentIntent(
      order.totalCents,
      order.id,
      tenantId,
    );

    // 4. Persistir el ID del PaymentIntent para poder reconciliar en el webhook.
    await this.prisma.order.update({
      where: { id: order.id },
      data: { stripePaymentIntentId: piId },
    });

    return {
      orderId: order.id,
      clientSecret,
      totalCents: order.totalCents,
      summary: {
        subtotalCents: priced.subtotalCents,
        discountCents: priced.discountCents,
        shippingCents: priced.shippingCents,
        discount: priced.discount,
      },
    };
  }
}
