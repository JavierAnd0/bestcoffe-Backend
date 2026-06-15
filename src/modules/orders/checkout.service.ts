import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CartService } from '../cart/cart.service';
import { StripeService } from '../stripe/stripe.service';
import { MercadoPagoService } from '../mercadopago/mercadopago.service';
import type { CreateOrderDto } from './dto/create-order.dto';

@Injectable()
export class CheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cart: CartService,
    private readonly stripe: StripeService,
    private readonly mercadopago: MercadoPagoService,
  ) {}

  async create(tenantId: string, customerId: string, dto: CreateOrderDto) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { paymentProvider: true, mpConnected: true },
    });

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
      throw new BadRequestException(`Stock insuficiente: ${outOfStock}`);
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

    const summary = {
      subtotalCents: priced.subtotalCents,
      discountCents: priced.discountCents,
      shippingCents: priced.shippingCents,
      discount: priced.discount,
    };

    // 3. Cobro según el proveedor configurado en la tienda.
    if (tenant.paymentProvider === 'MERCADOPAGO') {
      if (!tenant.mpConnected) {
        throw new BadRequestException(
          'La tienda no tiene MercadoPago conectado',
        );
      }
      if (!dto.payment) {
        throw new BadRequestException('Faltan los datos de pago (tarjeta)');
      }
      // createPayment persiste mpPaymentId en la orden (vía applyPaymentStatus),
      // de modo que el webhook pueda reconciliar el estado por ese id.
      const result = await this.mercadopago.createPayment(order.id, dto.payment);
      return {
        orderId: order.id,
        provider: 'MERCADOPAGO' as const,
        paymentStatus: result.status,
        statusDetail: result.statusDetail,
        mpPaymentId: result.mpPaymentId,
        totalCents: order.totalCents,
        summary,
      };
    }

    // Stripe (proveedor por defecto).
    const { clientSecret, piId } = await this.stripe.createPaymentIntent(
      order.totalCents,
      order.id,
      tenantId,
    );
    await this.prisma.order.update({
      where: { id: order.id },
      data: { stripePaymentIntentId: piId },
    });
    return {
      orderId: order.id,
      provider: 'STRIPE' as const,
      clientSecret,
      totalCents: order.totalCents,
      summary,
    };
  }
}
