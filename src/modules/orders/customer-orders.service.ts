import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { variantLabel } from './variant-label';

@Injectable()
export class CustomerOrdersService {
  constructor(private readonly prisma: PrismaService) {}

  /** Lista las órdenes del cliente (incluyendo órdenes recibidas y en proceso). */
  async list(customerId: string, cursor?: string, limit = 20) {
    const take = Math.min(limit, 50) + 1;
    const items = await this.prisma.order.findMany({
      where: {
        customerId,
      },
      take,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        paymentStatus: true,
        source: true,
        totalCents: true,
        discountCents: true,
        shippingCents: true,
        discountCode: true,
        trackingUrl: true,
        shippingCarrier: true,
        trackingNumber: true,
        createdAt: true,
        _count: { select: { items: true } },
      },
    });

    const hasMore = items.length > take - 1;
    const page = hasMore ? items.slice(0, -1) : items;
    return {
      items: page,
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  async findOne(customerId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, customerId },
      include: {
        // Solo la guía activa y lo que el cliente necesita: sin costo ni etiqueta.
        shipments: {
          where: { status: { not: 'CANCELLED' } },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            carrier: true,
            trackingNumber: true,
            trackingUrl: true,
            status: true,
            statusDetail: true,
            lastEventAt: true,
            deliveredAt: true,
          },
        },
        items: {
          select: {
            id: true,
            variantId: true,
            productName: true,
            variantName: true,
            grind: true,
            sizeGrams: true,
            unitCents: true,
            quantity: true,
            lineCents: true,
          },
        },
      },
    });
    if (!order) throw new NotFoundException('Pedido no encontrado');

    // El artículo es una copia fija del momento de la compra (sin imagen). Se
    // completa con la portada y el tipo del producto actual, si sigue existiendo.
    const variantIds = [...new Set(order.items.map((i) => i.variantId))];
    const variants = variantIds.length
      ? await this.prisma.productVariant.findMany({
          where: { id: { in: variantIds }, tenantId: order.tenantId },
          select: {
            id: true,
            product: {
              select: {
                slug: true,
                type: true,
                images: {
                  orderBy: { position: 'asc' },
                  take: 1,
                  select: { url: true, alt: true },
                },
              },
            },
          },
        })
      : [];
    const byId = new Map(variants.map((v) => [v.id, v.product]));

    // Lo interno de la tienda no sale hacia el cliente: sus notas sobre el
    // pedido y los identificadores de las pasarelas.
    /* eslint-disable @typescript-eslint/no-unused-vars */
    const {
      internalNotes,
      stripePaymentIntentId,
      mpPaymentId,
      epaycoRef,
      shipments,
      ...publicOrder
    } = order;
    /* eslint-enable @typescript-eslint/no-unused-vars */
    return {
      ...publicOrder,
      shipment: shipments[0] ?? null,
      items: order.items.map(({ variantId, ...item }) => {
        const product = byId.get(variantId);
        return {
          ...item,
          variantLabel: variantLabel({
            sizeGrams: item.sizeGrams,
            grind: item.grind,
            productType: product?.type,
          }),
          productSlug: product?.slug ?? null,
          imageUrl: product?.images[0]?.url ?? null,
          imageAlt: product?.images[0]?.alt ?? null,
        };
      }),
    };
  }
}
