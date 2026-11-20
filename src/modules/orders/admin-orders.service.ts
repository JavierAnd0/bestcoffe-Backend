import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { OrderSettlementService } from './order-settlement.service';
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
  shipments: { orderBy: { createdAt: 'desc' } },
} satisfies Prisma.OrderInclude;

@Injectable()
export class AdminOrdersService {
  private readonly logger = new Logger(AdminOrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly settlement: OrderSettlementService,
  ) {}

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

  /** Cambia el estado de fulfillment validando la transición y notificando al cliente. */
  async updateStatus(tenantId: string, id: string, dto: UpdateOrderStatusDto) {
    const order = await this.ensure(tenantId, id);
    const statusChanged = dto.status !== order.status;

    if (statusChanged) {
      const allowed = ALLOWED_TRANSITIONS[order.status];
      if (!allowed.includes(dto.status)) {
        throw new BadRequestException(
          `Transición no permitida: ${order.status} → ${dto.status}`,
        );
      }
    }

    // Si se cancela una orden que ya tenía pago procesado (o en proceso de entrega),
    // se restituye el stock reservado y el cupón de descuento dentro de una transacción.
    if (
      dto.status === OrderStatus.CANCELLED &&
      order.status !== OrderStatus.CANCELLED
    ) {
      const cancelledOrder =
        await this.settlement.cancelOrderAndRestoreInventory(id, {
          trackingUrl: dto.trackingUrl,
          include: {
            ...ORDER_DETAIL_INCLUDE,
            tenant: { select: { name: true } },
          },
        });

      if (cancelledOrder.customer?.email) {
        void this.mail
          .sendOrderCancelled({
            to: cancelledOrder.customer.email,
            customerName: cancelledOrder.customer.name,
            orderId: cancelledOrder.id,
            tenantId: cancelledOrder.tenantId,
          })
          .catch((err: unknown) =>
            this.logger.warn(
              `No se pudo enviar correo de cancelación para orden ${cancelledOrder.id}: ${String(err)}`,
            ),
          );
      }

      const { tenant: _tenant, ...rest } = cancelledOrder;
      void _tenant;
      return rest;
    }

    const updated = await this.prisma.order.update({
      where: { id },
      data: {
        status: dto.status,
        ...(dto.trackingUrl !== undefined && { trackingUrl: dto.trackingUrl }),
      },
      include: {
        ...ORDER_DETAIL_INCLUDE,
        tenant: { select: { name: true } },
      },
    });

    if (
      statusChanged &&
      dto.status === OrderStatus.SHIPPED &&
      updated.customer?.email
    ) {
      void this.mail
        .sendOrderShipped({
          to: updated.customer.email,
          customerName: updated.customer.name,
          orderId: updated.id,
          tenantId: updated.tenantId,
          trackingUrl: updated.trackingUrl,
        })
        .catch((err: unknown) =>
          this.logger.warn(
            `No se pudo enviar correo de despacho para orden ${updated.id}: ${String(err)}`,
          ),
        );
    }

    const { tenant: _tenant, ...rest } = updated;
    void _tenant;
    return rest;
  }

  /** Ediciones administrativas (tracking, pago, notas internas). */
  async update(tenantId: string, id: string, dto: UpdateOrderDto) {
    const current = await this.ensure(tenantId, id);
    // Marcar un pedido como pagado a mano (transferencia / contra entrega) pasa
    // por la misma liquidación que un pago de pasarela: descuenta inventario,
    // cuenta el cupón y envía la confirmación. Es idempotente.
    // La dirección solo se corrige antes de despachar: después ya va en camino
    // (o se entregó o canceló) y cambiarla en el sistema no cambia el paquete.
    if (
      dto.shippingAddress !== undefined &&
      current.status !== 'RECEIVED' &&
      current.status !== 'PREPARING'
    ) {
      throw new BadRequestException(
        'La dirección solo se puede cambiar antes del despacho',
      );
    }
    const manualPaid = dto.paymentStatus === 'PAID';
    if (manualPaid) {
      // Un pedido cancelado ya devolvió su stock y uno reembolsado ya lo
      // descontó: liquidarlos de nuevo duplicaría el movimiento de inventario.
      if (current.status === 'CANCELLED') {
        throw new BadRequestException(
          'No se puede marcar como pagado un pedido cancelado',
        );
      }
      if (current.paymentStatus === 'REFUNDED') {
        throw new BadRequestException(
          'No se puede marcar como pagado un pedido reembolsado',
        );
      }
      await this.settlement.settlePaidOrder(id, { provider: 'MANUAL' });
    }
    return this.prisma.order.update({
      where: { id },
      data: {
        ...(dto.paymentStatus !== undefined &&
          !manualPaid && {
            paymentStatus: dto.paymentStatus,
          }),
        ...(dto.trackingUrl !== undefined && { trackingUrl: dto.trackingUrl }),
        ...(dto.internalNotes !== undefined && {
          internalNotes: dto.internalNotes,
        }),
        ...(dto.shippingAddress !== undefined && {
          shippingAddress:
            dto.shippingAddress as unknown as Prisma.InputJsonValue,
        }),
      },
      include: ORDER_DETAIL_INCLUDE,
    });
  }

  private async ensure(tenantId: string, id: string) {
    const order = await this.prisma.order.findFirst({
      where: { id, tenantId },
      select: { id: true, status: true, paymentStatus: true },
    });
    if (!order) throw new NotFoundException('Pedido no encontrado');
    return order;
  }
}
