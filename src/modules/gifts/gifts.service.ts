import { Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { GiftStatus, Prisma, SubStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateGiftDto } from './dto/create-gift.dto';
import { RedeemGiftDto } from './dto/redeem-gift.dto';

const DAY_MS = 24 * 60 * 60 * 1000;

function generateRedemptionCode(): string {
  const hex = randomBytes(6).toString('hex').toUpperCase();
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8)}`;
}

@Injectable()
export class GiftsService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Admin ──────────────────────────────────────────────────────────────────

  async create(tenantId: string, dto: CreateGiftDto) {
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: dto.variantId, tenantId },
      select: { id: true },
    });
    if (!variant) throw new NotFoundException('Variante no encontrada');

    let code: string;
    let attempts = 0;
    do {
      code = generateRedemptionCode();
      attempts++;
      const exists = await this.prisma.giftSubscription.findUnique({
        where: { redemptionCode: code },
        select: { id: true },
      });
      if (!exists) break;
    } while (attempts < 5);

    return this.prisma.giftSubscription.create({
      data: {
        tenantId,
        variantId: dto.variantId,
        buyerEmail: dto.buyerEmail,
        totalShipments: dto.totalShipments,
        message: dto.message,
        redemptionCode: code!,
        status: GiftStatus.PENDING_ACTIVATION,
      },
    });
  }

  async list(tenantId: string, cursor?: string, limit = 25) {
    const take = Math.min(limit, 100) + 1;
    const items = await this.prisma.giftSubscription.findMany({
      where: { tenantId },
      take,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        buyerEmail: true,
        redemptionCode: true,
        totalShipments: true,
        shipmentsUsed: true,
        status: true,
        createdAt: true,
        variant: {
          select: {
            sizeGrams: true,
            grind: true,
            product: { select: { name: true, slug: true } },
          },
        },
      },
    });
    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;
    return { items: page, nextCursor: hasMore ? page[page.length - 1].id : null };
  }

  // ── Customer ───────────────────────────────────────────────────────────────

  async redeem(customerId: string, tenantId: string, dto: RedeemGiftDto) {
    const gift = await this.prisma.giftSubscription.findFirst({
      where: {
        redemptionCode: dto.redemptionCode,
        tenantId,
        status: GiftStatus.PENDING_ACTIVATION,
      },
    });
    if (!gift) throw new NotFoundException('Código de regalo no válido o ya utilizado');

    let shippingAddress: Prisma.InputJsonValue | undefined;
    if (dto.addressId) {
      const addr = await this.prisma.address.findFirst({
        where: { id: dto.addressId, customerId },
        select: {
          line1: true, line2: true, city: true,
          state: true, postalCode: true, country: true, phone: true,
        },
      });
      if (!addr) throw new NotFoundException('Dirección no encontrada');
      shippingAddress = addr as Prisma.InputJsonValue;
    }

    const frequencyDays = dto.frequencyDays ?? 30;
    const nextShipAt = new Date(Date.now() + frequencyDays * DAY_MS);

    return this.prisma.$transaction(async (tx) => {
      const subscription = await tx.subscription.create({
        data: {
          tenantId,
          customerId,
          variantId: gift.variantId,
          frequencyDays,
          status: SubStatus.ACTIVE,
          nextShipAt,
          ...(shippingAddress && { shippingAddress }),
        },
        select: {
          id: true,
          status: true,
          frequencyDays: true,
          nextShipAt: true,
          variant: {
            select: {
              sizeGrams: true,
              grind: true,
              product: { select: { name: true, slug: true } },
            },
          },
        },
      });

      const updatedGift = await tx.giftSubscription.update({
        where: { id: gift.id },
        data: {
          status: GiftStatus.ACTIVE,
          linkedSubscriptionId: subscription.id,
        },
        select: {
          id: true,
          totalShipments: true,
          shipmentsUsed: true,
          message: true,
        },
      });

      return { subscription, gift: updatedGift };
    });
  }
}
