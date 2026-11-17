import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, ProductStatus, SubAvail, SubStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StripeService } from '../stripe/stripe.service';
import { SubscriptionLifecycleService } from './subscription-lifecycle.service';
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
      product: {
        select: {
          slug: true,
          name: true,
          images: {
            select: { url: true, alt: true },
            orderBy: { position: 'asc' },
            take: 1,
          },
        },
      },
    },
  },
} satisfies Prisma.SubscriptionSelect;

@Injectable()
export class CustomerSubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
    private readonly lifecycle: SubscriptionLifecycleService,
    private readonly config: ConfigService,
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
    return {
      items: page,
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  async findOne(customerId: string, id: string) {
    const sub = await this.prisma.subscription.findFirst({
      where: { id, customerId },
      select: SUB_SELECT,
    });
    if (!sub) throw new NotFoundException('Suscripción no encontrada');
    return sub;
  }

  /**
   * Alta directa con método de pago guardado en Stripe (SetupIntent). Solo
   * existe en el modo de pruebas de plataforma (`STRIPE_CHECKOUT_ENABLED=1`):
   * sin él, Stripe cobraría en la cuenta de la plataforma y no en la de la
   * tienda. El alta normal es el checkout (`POST /v1/orders` con
   * `mode: SUBSCRIPTION`), que crea la suscripción junto a su primer pedido.
   */
  async create(
    customerId: string,
    tenantId: string,
    dto: CreateSubscriptionDto,
  ) {
    if (this.config.get<boolean>('stripe.checkoutEnabled') !== true) {
      throw new NotFoundException(
        'Las suscripciones se crean al hacer un pedido por suscripción en el checkout',
      );
    }
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
      select: {
        id: true,
        email: true,
        name: true,
        stripeCustomerId: true,
        tenantId: true,
      },
    });
    const stripeCustomerId =
      await this.stripe.createOrGetStripeCustomer(customer);

    const nextShipAt = new Date(Date.now() + dto.frequencyDays * DAY_MS);

    const sub = await this.prisma.subscription.create({
      data: {
        tenantId,
        customerId,
        variantId: dto.variantId,
        frequencyDays: dto.frequencyDays,
        status: SubStatus.PAUSED,
        nextShipAt,
        ...(shippingAddress && {
          shippingAddress: shippingAddress as Prisma.InputJsonValue,
        }),
      },
    });

    const clientSecret = await this.stripe.createSetupIntent(stripeCustomerId, {
      subscriptionId: sub.id,
      tenantId,
      customerId,
    });

    return { subscriptionId: sub.id, clientSecret };
  }

  updateFrequency(customerId: string, id: string, frequencyDays: number) {
    return this.lifecycle.updateTerms(
      { id, customerId },
      { frequencyDays },
      SUB_SELECT,
    );
  }

  pause(customerId: string, id: string) {
    return this.lifecycle.pause({ id, customerId }, SUB_SELECT);
  }

  resume(customerId: string, id: string) {
    return this.lifecycle.resume({ id, customerId }, SUB_SELECT);
  }

  skipNext(customerId: string, id: string) {
    return this.lifecycle.skipNext({ id, customerId }, SUB_SELECT);
  }

  cancel(customerId: string, id: string) {
    return this.lifecycle.cancel({ id, customerId }, SUB_SELECT);
  }
}
