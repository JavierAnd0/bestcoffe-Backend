import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SubStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const DAY_MS = 24 * 60 * 60 * 1000;

export type SubscriptionScope =
  | { id: string; customerId: string }
  | { id: string; tenantId: string };

/**
 * Módulo profundo (Deep Module) que gobierna la máquina de estados e
 * invariantes temporales de una suscripción (`pause`, `resume`, `skipNext`,
 * `cancel` y `updateTerms`).
 *
 * Tanto `CustomerSubscriptionsService` (scope por `customerId`) como
 * `AdminSubscriptionsService` (scope por `tenantId`) delegan aquí para que
 * exista una única fuente de verdad de las reglas de negocio.
 */
@Injectable()
export class SubscriptionLifecycleService {
  constructor(private readonly prisma: PrismaService) {}

  /** Pausa una suscripción desde cualquier estado no cancelado (`ACTIVE`, `SKIPPED_NEXT`, `PAYMENT_FAILED`). */
  async pause<TSelect extends Prisma.SubscriptionSelect>(
    scope: SubscriptionScope,
    select: TSelect,
  ): Promise<Prisma.SubscriptionGetPayload<{ select: TSelect }>> {
    const sub = await this.ensure(scope);
    this.assertNotCancelled(sub.status);
    if (sub.status === SubStatus.PAUSED) {
      throw new BadRequestException('La suscripción ya está pausada');
    }
    return this.prisma.subscription.update({
      where: { id: sub.id },
      data: { status: SubStatus.PAUSED },
      select,
    });
  }

  /**
   * Reanuda una suscripción pausada. Si `nextShipAt` quedó en el pasado,
   * la reprograma a `hoy + frequencyDays` para evitar un cobro inmediato.
   */
  async resume<TSelect extends Prisma.SubscriptionSelect>(
    scope: SubscriptionScope,
    select: TSelect,
  ): Promise<Prisma.SubscriptionGetPayload<{ select: TSelect }>> {
    const sub = await this.ensure(scope);
    if (sub.status !== SubStatus.PAUSED) {
      throw new BadRequestException('Solo se reanuda una suscripción pausada');
    }
    const data: Prisma.SubscriptionUpdateInput = { status: SubStatus.ACTIVE };
    if (sub.nextShipAt.getTime() < Date.now()) {
      data.nextShipAt = new Date(Date.now() + sub.frequencyDays * DAY_MS);
    }
    return this.prisma.subscription.update({
      where: { id: sub.id },
      data,
      select,
    });
  }

  /** Salta el próximo envío de una suscripción activa adelantando `nextShipAt` una frecuencia. */
  async skipNext<TSelect extends Prisma.SubscriptionSelect>(
    scope: SubscriptionScope,
    select: TSelect,
  ): Promise<Prisma.SubscriptionGetPayload<{ select: TSelect }>> {
    const sub = await this.ensure(scope);
    if (sub.status !== SubStatus.ACTIVE) {
      throw new BadRequestException(
        'Solo se puede saltar el próximo envío de una suscripción activa',
      );
    }
    return this.prisma.subscription.update({
      where: { id: sub.id },
      data: {
        status: SubStatus.SKIPPED_NEXT,
        nextShipAt: new Date(
          sub.nextShipAt.getTime() + sub.frequencyDays * DAY_MS,
        ),
      },
      select,
    });
  }

  /** Cancela la suscripción (estado terminal). */
  async cancel<TSelect extends Prisma.SubscriptionSelect>(
    scope: SubscriptionScope,
    select: TSelect,
  ): Promise<Prisma.SubscriptionGetPayload<{ select: TSelect }>> {
    const sub = await this.ensure(scope);
    this.assertNotCancelled(sub.status);
    return this.prisma.subscription.update({
      where: { id: sub.id },
      data: { status: SubStatus.CANCELLED },
      select,
    });
  }

  /** Actualiza frecuencia o porcentaje de descuento validando que no esté cancelada. */
  async updateTerms<TSelect extends Prisma.SubscriptionSelect>(
    scope: SubscriptionScope,
    terms: { frequencyDays?: number; discountPct?: number },
    select: TSelect,
  ): Promise<Prisma.SubscriptionGetPayload<{ select: TSelect }>> {
    const sub = await this.ensure(scope);
    this.assertNotCancelled(sub.status);
    return this.prisma.subscription.update({
      where: { id: sub.id },
      data: {
        ...(terms.frequencyDays !== undefined && {
          frequencyDays: terms.frequencyDays,
        }),
        ...(terms.discountPct !== undefined && {
          discountPct: terms.discountPct,
        }),
      },
      select,
    });
  }

  private assertNotCancelled(status: SubStatus) {
    if (status === SubStatus.CANCELLED) {
      throw new BadRequestException(
        'La suscripción está cancelada y no admite cambios',
      );
    }
  }

  private async ensure(scope: SubscriptionScope) {
    const sub = await this.prisma.subscription.findFirst({
      where: scope,
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
