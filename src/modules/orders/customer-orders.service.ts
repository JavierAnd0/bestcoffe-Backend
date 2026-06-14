import { Injectable, NotFoundException } from '@nestjs/common';
import { PaymentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class CustomerOrdersService {
  constructor(private readonly prisma: PrismaService) {}

  /** Lista las órdenes del cliente. Excluye las PENDING (checkout abandonado). */
  async list(customerId: string, cursor?: string, limit = 20) {
    const take = Math.min(limit, 50) + 1;
    const items = await this.prisma.order.findMany({
      where: {
        customerId,
        paymentStatus: { not: PaymentStatus.PENDING },
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
        items: {
          select: {
            id: true,
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
    return order;
  }
}
