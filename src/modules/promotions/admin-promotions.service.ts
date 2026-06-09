import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DiscountType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateDiscountCodeDto } from './dto/create-discount-code.dto';
import { UpdateDiscountCodeDto } from './dto/update-discount-code.dto';
import { ListDiscountCodesDto } from './dto/list-discount-codes.dto';

@Injectable()
export class AdminPromotionsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Listado de códigos del tenant (opcional por estado), más recientes primero. */
  async list(tenantId: string, dto: ListDiscountCodesDto) {
    return this.prisma.discountCode.findMany({
      where: { tenantId, ...(dto.active !== undefined && { active: dto.active }) },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(tenantId: string, id: string) {
    const code = await this.prisma.discountCode.findFirst({
      where: { id, tenantId },
    });
    if (!code) throw new NotFoundException('Código no encontrado');
    return code;
  }

  async create(tenantId: string, dto: CreateDiscountCodeDto) {
    this.assertValue(dto.type, dto.value);
    this.assertWindow(dto.startsAt, dto.endsAt);
    await this.assertCodeFree(tenantId, dto.code);

    return this.prisma.discountCode.create({
      data: {
        tenantId,
        code: dto.code,
        type: dto.type,
        value: dto.value,
        minSubtotalCents: dto.minSubtotalCents ?? null,
        maxRedemptions: dto.maxRedemptions ?? null,
        oneUsePerCustomer: dto.oneUsePerCustomer ?? false,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
        endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
        active: dto.active ?? true,
      },
    });
  }

  async update(tenantId: string, id: string, dto: UpdateDiscountCodeDto) {
    const existing = await this.findOne(tenantId, id);

    const type = dto.type ?? existing.type;
    const value = dto.value ?? existing.value;
    if (dto.type !== undefined || dto.value !== undefined) {
      this.assertValue(type, value);
    }

    const startsAt =
      dto.startsAt !== undefined
        ? dto.startsAt
          ? new Date(dto.startsAt)
          : null
        : existing.startsAt;
    const endsAt =
      dto.endsAt !== undefined
        ? dto.endsAt
          ? new Date(dto.endsAt)
          : null
        : existing.endsAt;
    this.assertWindow(startsAt, endsAt);

    if (dto.code && dto.code !== existing.code) {
      await this.assertCodeFree(tenantId, dto.code);
    }

    return this.prisma.discountCode.update({
      where: { id },
      data: {
        ...(dto.code !== undefined && { code: dto.code }),
        ...(dto.type !== undefined && { type: dto.type }),
        ...(dto.value !== undefined && { value: dto.value }),
        ...(dto.minSubtotalCents !== undefined && {
          minSubtotalCents: dto.minSubtotalCents,
        }),
        ...(dto.maxRedemptions !== undefined && {
          maxRedemptions: dto.maxRedemptions,
        }),
        ...(dto.oneUsePerCustomer !== undefined && {
          oneUsePerCustomer: dto.oneUsePerCustomer,
        }),
        ...(dto.startsAt !== undefined && { startsAt }),
        ...(dto.endsAt !== undefined && { endsAt }),
        ...(dto.active !== undefined && { active: dto.active }),
      },
    });
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    await this.prisma.discountCode.delete({ where: { id } });
    return { id, deleted: true };
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  /** PERCENTAGE exige 1-100; FIXED solo > 0 (ya garantizado por el DTO). */
  private assertValue(type: DiscountType, value: number) {
    if (type === DiscountType.PERCENTAGE && (value < 1 || value > 100)) {
      throw new BadRequestException(
        'Un descuento PERCENTAGE debe estar entre 1 y 100',
      );
    }
  }

  private assertWindow(
    startsAt?: Date | string | null,
    endsAt?: Date | string | null,
  ) {
    if (!startsAt || !endsAt) return;
    if (new Date(startsAt).getTime() > new Date(endsAt).getTime()) {
      throw new BadRequestException('startsAt no puede ser posterior a endsAt');
    }
  }

  private async assertCodeFree(tenantId: string, code: string) {
    const clash = await this.prisma.discountCode.findUnique({
      where: { tenantId_code: { tenantId, code } },
      select: { id: true },
    });
    if (clash) throw new BadRequestException(`El código "${code}" ya existe`);
  }
}
