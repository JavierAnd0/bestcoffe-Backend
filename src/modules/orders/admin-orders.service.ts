import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ListOrdersDto } from './dto/list-orders.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { UpdateOrderDto } from './dto/update-order.dto';

/**
 * Transiciones de fulfillment permitidas. RECEIVED → PREPARING → SHIPPED →
 * DELIVERED es el camino feliz; CANCELLED es alcanzable desde cualquier estado
 * no terminal. DELIVERED y CANCELLED son terminales.
 */
const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.RECEIVED]: [OrderStatus.PREPARING, OrderStatus.CANCELLED],
  [OrderStatus.PREPARING]: [OrderStatus.SHIPPED, OrderStatus.CANCELLED],
  [OrderStatus.SHIPPED]: [OrderStatus.DELIVERED, OrderStatus.CANCELLED],
  [OrderStatus.DELIVERED]: [],
  [OrderStatus.CANCELLED]: [],
};

const ORDER_DETAIL_INCLUDE = {
  items: true,
  customer: { select: { id: true, email: true, name: true } },
} satisfies Prisma.OrderInclude;

@Injectable()
export class AdminOrdersService {
  constructor(private readonly prisma: PrismaService) {}

  /** Listado admin con filtros y paginación keyset por createdAt/id. */
  async list(tenantId: string, dto: ListOrdersDto) {
    const limit = dto.limit ?? 25;
    const items = await this.prisma.order.findMany({
      where: {
        tenantId,
        ...(dto.status && { status: dto.status }),
        ...(dto.paymentStatus && { paymentStatus: dto.paymentStatus }),
        ...(dto.customerId && { customerId: dto.customerId }),
      },
      take: limit + 1,
      ...(dto.cursor && { cursor: { id: dto.cursor }, skip: 1 }),
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        paymentStatus: true,
        source: true,
        totalCents: true,
        createdAt: true,
        customer: { select: { id: true, email: true, name: true } },
        _count: { select: { items: true } },
      },
    });
    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;
    return {
      items: page,
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  async findOne(tenantId: string, id: string) {
    const order = await this.prisma.order.findFirst({
      where: { id, tenantId },
      include: ORDER_DETAIL_INCLUDE,
    });
    if (!order) throw new NotFoundException('Pedido no encontrado');
    return order;
  }

  /** Cambia el estado de fulfillment validando la transición. */
  async updateStatus(tenantId: string, id: string, dto: UpdateOrderStatusDto) {
    const order = await this.ensure(tenantId, id);

    if (dto.status !== order.status) {
      const allowed = ALLOWED_TRANSITIONS[order.status];
      if (!allowed.includes(dto.status)) {
        throw new BadRequestException(
          `Transición no permitida: ${order.status} → ${dto.status}`,
        );
      }
    }

    return this.prisma.order.update({
      where: { id },
      data: {
        status: dto.status,
        ...(dto.trackingUrl !== undefined && { trackingUrl: dto.trackingUrl }),
      },
      include: ORDER_DETAIL_INCLUDE,
    });
  }

  /** Ediciones administrativas (tracking, pago, notas internas). */
  async update(tenantId: string, id: string, dto: UpdateOrderDto) {
    await this.ensure(tenantId, id);
    return this.prisma.order.update({
      where: { id },
      data: {
        ...(dto.paymentStatus !== undefined && {
          paymentStatus: dto.paymentStatus,
        }),
        ...(dto.trackingUrl !== undefined && { trackingUrl: dto.trackingUrl }),
        ...(dto.internalNotes !== undefined && {
          internalNotes: dto.internalNotes,
        }),
      },
      include: ORDER_DETAIL_INCLUDE,
    });
  }

  private async ensure(tenantId: string, id: string) {
    const order = await this.prisma.order.findFirst({
      where: { id, tenantId },
      select: { id: true, status: true },
    });
    if (!order) throw new NotFoundException('Pedido no encontrado');
    return order;
  }
}
