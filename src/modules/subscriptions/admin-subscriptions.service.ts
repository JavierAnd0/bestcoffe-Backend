import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SubscriptionLifecycleService } from './subscription-lifecycle.service';
import { ListSubscriptionsDto } from './dto/list-subscriptions.dto';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';

const SUB_DETAIL_SELECT = {
  id: true,
  tenantId: true,
  customerId: true,
  variantId: true,
  frequencyDays: true,
  status: true,
  lastShippedAt: true,
  nextShipAt: true,
  discountPct: true,
  shippingAddress: true,
  stripeSubscriptionId: true,
  createdAt: true,
  updatedAt: true,
  customer: { select: { id: true, email: true, name: true } },
  variant: {
    select: {
      id: true,
      sizeGrams: true,
      grind: true,
      product: { select: { slug: true, name: true } },
    },
  },
} satisfies Prisma.SubscriptionSelect;

@Injectable()
export class AdminSubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: SubscriptionLifecycleService,
  ) {}

  /** Listado admin con filtros y paginación keyset por nextShipAt/id. */
  async list(tenantId: string, dto: ListSubscriptionsDto) {
    const limit = dto.limit ?? 25;
    const items = await this.prisma.subscription.findMany({
      where: {
        tenantId,
        ...(dto.status && { status: dto.status }),
        ...(dto.customerId && { customerId: dto.customerId }),
      },
      take: limit + 1,
      ...(dto.cursor && { cursor: { id: dto.cursor }, skip: 1 }),
      orderBy: { nextShipAt: 'asc' },
      select: {
        id: true,
        status: true,
        frequencyDays: true,
        discountPct: true,
        nextShipAt: true,
        lastShippedAt: true,
        customer: { select: { id: true, email: true, name: true } },
        variant: {
          select: {
            sizeGrams: true,
            grind: true,
            product: { select: { slug: true, name: true } },
          },
        },
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
    const sub = await this.prisma.subscription.findFirst({
      where: { id, tenantId },
      select: SUB_DETAIL_SELECT,
    });
    if (!sub) throw new NotFoundException('Suscripción no encontrada');
    return sub;
  }

  /** Pausa una suscripción activa (o en SKIPPED_NEXT / PAYMENT_FAILED). */
  pause(tenantId: string, id: string) {
    return this.lifecycle.pause({ id, tenantId }, SUB_DETAIL_SELECT);
  }

  /**
   * Reanuda una suscripción pausada. Si la próxima fecha quedó en el pasado,
   * la reprograma a hoy + frecuencia para no disparar un envío inmediato.
   */
  resume(tenantId: string, id: string) {
    return this.lifecycle.resume({ id, tenantId }, SUB_DETAIL_SELECT);
  }

  /** Salta el próximo envío: empuja nextShipAt una frecuencia hacia adelante. */
  skipNext(tenantId: string, id: string) {
    return this.lifecycle.skipNext({ id, tenantId }, SUB_DETAIL_SELECT);
  }

  /** Cancela la suscripción (terminal). */
  cancel(tenantId: string, id: string) {
    return this.lifecycle.cancel({ id, tenantId }, SUB_DETAIL_SELECT);
  }

  /** Edita frecuencia y/o descuento sin tocar el estado. */
  update(tenantId: string, id: string, dto: UpdateSubscriptionDto) {
    return this.lifecycle.updateTerms(
      { id, tenantId },
      { frequencyDays: dto.frequencyDays, discountPct: dto.discountPct },
      SUB_DETAIL_SELECT,
    );
  }
}
