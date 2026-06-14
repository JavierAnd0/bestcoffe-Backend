import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProductStatus, SubAvail, SubStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StripeService } from '../stripe/stripe.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';

const DAY_MS = 24 * 60 * 60 * 1000;

const SUB_SELECT = {
  id: true,
  status: true,
  frequencyDays: true,
  discountPct: true,
  nextShipAt: true,
  lastShippedAt: true,
  shippingAddress: true,
  createdAt: true,
  variant: {
    select: {
      id: true,
      sizeGrams: true,
      grind: true,
      priceSubscription: true,
      priceOneTime: true,
      product: { select: { slug: true, name: true } },
    },
  },
} satisfies Prisma.SubscriptionSelect;

@Injectable()
export class CustomerSubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
  ) {}

  async list(customerId: string, cursor?: string, limit = 20) {
    const take = Math.min(limit, 50) + 1;
    const items = await this.prisma.subscription.findMany({
      where: { customerId },
      take,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
      orderBy: { nextShipAt: 'asc' },
      select: SUB_SELECT,
    });
    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;
    return { items: page, nextCursor: hasMore ? page[page.length - 1].id : null };
  }

  async findOne(customerId: string, id: string) {
    const sub = await this.prisma.subscription.findFirst({
      where: { id, customerId },
      select: SUB_SELECT,
    });
    if (!sub) throw new NotFoundException('Suscripción no encontrada');
    return sub;
  }

  async create(customerId: string, tenantId: string, dto: CreateSubscriptionDto) {
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: dto.variantId, tenantId },
      select: {
        id: true,
        product: { select: { status: true, subscriptionAvailability: true } },
      },
    });
    if (!variant) throw new NotFoundException('Variante no encontrada');
    if (variant.product.status !== ProductStatus.ACTIVE) {
      throw new BadRequestException('El producto no está activo');
    }
    if (variant.product.subscriptionAvailability === SubAvail.NO) {
      throw new BadRequestException(
        'Este producto no está disponible para suscripción',
      );
    }

    let shippingAddress: Record<string, unknown> | null = null;
    if (dto.addressId) {
      const addr = await this.prisma.address.findFirst({
        where: { id: dto.addressId, customerId },
        select: {
          line1: true,
          line2: true,
          city: true,
          state: true,
          postalCode: true,
          country: true,
          phone: true,
        },
      });
      if (!addr) throw new NotFoundException('Dirección no encontrada');
      shippingAddress = addr;
    }

    const customer = await this.prisma.customer.findUniqueOrThrow({
      where: { id: customerId },
      select: { id: true, email: true, name: true, stripeCustomerId: true, tenantId: true },
    });
    const stripeCustomerId = await this.stripe.createOrGetStripeCustomer(customer);

    const nextShipAt = new Date(Date.now() + dto.frequencyDays * DAY_MS);

    const sub = await this.prisma.subscription.create({
      data: {
        tenantId,
        customerId,
        variantId: dto.variantId,
        frequencyDays: dto.frequencyDays,
        status: SubStatus.PAUSED,
        nextShipAt,
        ...(shippingAddress && { shippingAddress: shippingAddress as Prisma.InputJsonValue }),
      },
    });

    const clientSecret = await this.stripe.createSetupIntent(stripeCustomerId, {
      subscriptionId: sub.id,
      tenantId,
      customerId,
    });

    return { subscriptionId: sub.id, clientSecret };
  }

  async pause(customerId: string, id: string) {
    const sub = await this.ensureOwnership(customerId, id);
    if (sub.status === SubStatus.CANCELLED) {
      throw new BadRequestException('La suscripción está cancelada y no admite cambios');
    }
    if (sub.status === SubStatus.PAUSED) {
      throw new BadRequestException('La suscripción ya está pausada');
    }
    return this.setStatus(id, SubStatus.PAUSED);
  }

  async resume(customerId: string, id: string) {
    const sub = await this.ensureOwnership(customerId, id);
    if (sub.status !== SubStatus.PAUSED) {
      throw new BadRequestException('Solo se reanuda una suscripción pausada');
    }
    const data: Prisma.SubscriptionUpdateInput = { status: SubStatus.ACTIVE };
    if (sub.nextShipAt.getTime() < Date.now()) {
      data.nextShipAt = new Date(Date.now() + sub.frequencyDays * DAY_MS);
    }
    return this.prisma.subscription.update({ where: { id }, data, select: SUB_SELECT });
  }

  async skipNext(customerId: string, id: string) {
    const sub = await this.ensureOwnership(customerId, id);
    if (sub.status !== SubStatus.ACTIVE) {
      throw new BadRequestException(
        'Solo se puede saltar el próximo envío de una suscripción activa',
      );
    }
    return this.prisma.subscription.update({
      where: { id },
      data: {
        status: SubStatus.SKIPPED_NEXT,
        nextShipAt: new Date(sub.nextShipAt.getTime() + sub.frequencyDays * DAY_MS),
      },
      select: SUB_SELECT,
    });
  }

  async cancel(customerId: string, id: string) {
    const sub = await this.ensureOwnership(customerId, id);
    if (sub.status === SubStatus.CANCELLED) {
      throw new BadRequestException('La suscripción ya está cancelada');
    }
    return this.setStatus(id, SubStatus.CANCELLED);
  }

  private setStatus(id: string, status: SubStatus) {
    return this.prisma.subscription.update({ where: { id }, data: { status }, select: SUB_SELECT });
  }

  private async ensureOwnership(customerId: string, id: string) {
    const sub = await this.prisma.subscription.findFirst({
      where: { id, customerId },
      select: { id: true, status: true, nextShipAt: true, frequencyDays: true },
    });
    if (!sub) throw new NotFoundException('Suscripción no encontrada');
    return sub;
  }
}
