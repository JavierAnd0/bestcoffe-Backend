import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SubStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ListSubscriptionsDto } from './dto/list-subscriptions.dto';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';

const SUB_DETAIL_INCLUDE = {
  customer: { select: { id: true, email: true, name: true } },
  variant: {
    select: {
      id: true,
      sizeGrams: true,
      grind: true,
      product: { select: { slug: true, name: true } },
    },
  },
} satisfies Prisma.SubscriptionInclude;

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class AdminSubscriptionsService {
  constructor(private readonly prisma: PrismaService) {}

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
      include: SUB_DETAIL_INCLUDE,
    });
    if (!sub) throw new NotFoundException('Suscripción no encontrada');
    return sub;
  }

  /** Pausa una suscripción activa (o en SKIPPED_NEXT / PAYMENT_FAILED). */
  async pause(tenantId: string, id: string) {
    const sub = await this.ensure(tenantId, id);
    this.assertNotCancelled(sub.status);
    if (sub.status === SubStatus.PAUSED) {
      throw new BadRequestException('La suscripción ya está pausada');
    }
    return this.setStatus(id, SubStatus.PAUSED);
  }

  /**
   * Reanuda una suscripción pausada. Si la próxima fecha quedó en el pasado,
   * la reprograma a hoy + frecuencia para no disparar un envío inmediato.
   */
  async resume(tenantId: string, id: string) {
    const sub = await this.ensure(tenantId, id);
    if (sub.status !== SubStatus.PAUSED) {
      throw new BadRequestException('Solo se reanuda una suscripción pausada');
    }
    const data: Prisma.SubscriptionUpdateInput = { status: SubStatus.ACTIVE };
    if (sub.nextShipAt.getTime() < Date.now()) {
      data.nextShipAt = new Date(Date.now() + sub.frequencyDays * DAY_MS);
    }
    return this.prisma.subscription.update({
      where: { id },
      data,
      include: SUB_DETAIL_INCLUDE,
    });
  }

  /** Salta el próximo envío: empuja nextShipAt una frecuencia hacia adelante. */
  async skipNext(tenantId: string, id: string) {
    const sub = await this.ensure(tenantId, id);
    if (sub.status !== SubStatus.ACTIVE) {
      throw new BadRequestException(
        'Solo se puede saltar el próximo envío de una suscripción activa',
      );
    }
    return this.prisma.subscription.update({
      where: { id },
      data: {
        status: SubStatus.SKIPPED_NEXT,
        nextShipAt: new Date(
          sub.nextShipAt.getTime() + sub.frequencyDays * DAY_MS,
        ),
      },
      include: SUB_DETAIL_INCLUDE,
    });
  }

  /** Cancela la suscripción (terminal). */
  async cancel(tenantId: string, id: string) {
    const sub = await this.ensure(tenantId, id);
    this.assertNotCancelled(sub.status);
    return this.setStatus(id, SubStatus.CANCELLED);
  }

  /** Edita frecuencia y/o descuento sin tocar el estado. */
  async update(tenantId: string, id: string, dto: UpdateSubscriptionDto) {
    const sub = await this.ensure(tenantId, id);
    this.assertNotCancelled(sub.status);
    return this.prisma.subscription.update({
      where: { id },
      data: {
        ...(dto.frequencyDays !== undefined && {
          frequencyDays: dto.frequencyDays,
        }),
        ...(dto.discountPct !== undefined && { discountPct: dto.discountPct }),
      },
      include: SUB_DETAIL_INCLUDE,
    });
  }

  private setStatus(id: string, status: SubStatus) {
    return this.prisma.subscription.update({
      where: { id },
      data: { status },
      include: SUB_DETAIL_INCLUDE,
    });
  }

  private assertNotCancelled(status: SubStatus) {
    if (status === SubStatus.CANCELLED) {
      throw new BadRequestException(
        'La suscripción está cancelada y no admite cambios',
      );
    }
  }

  private async ensure(tenantId: string, id: string) {
    const sub = await this.prisma.subscription.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        status: true,
        nextShipAt: true,
        frequencyDays: true,
      },
    });
    if (!sub) throw new NotFoundException('Suscripción no encontrada');
    return sub;
  }
}
