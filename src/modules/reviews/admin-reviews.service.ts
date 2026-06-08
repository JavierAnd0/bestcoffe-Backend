import { Injectable, NotFoundException } from '@nestjs/common';
import { ReviewStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RevalidationService } from '../revalidation/revalidation.service';
import { ApproveReviewDto, ReplyReviewDto } from './dto/moderate-review.dto';

@Injectable()
export class AdminReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly revalidation: RevalidationService,
  ) {}

  /** Cola de moderación (por defecto PENDING), con datos de producto y cliente. */
  async list(tenantId: string, status: ReviewStatus = ReviewStatus.PENDING) {
    return this.prisma.review.findMany({
      where: { tenantId, status },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        rating: true,
        title: true,
        body: true,
        status: true,
        verifiedSubscriber: true,
        reply: true,
        createdAt: true,
        product: { select: { slug: true, name: true } },
        customer: { select: { email: true, name: true } },
      },
    });
  }

  async approve(
    tenantId: string,
    tenantSlug: string,
    id: string,
    dto: ApproveReviewDto,
  ) {
    const review = await this.ensure(tenantId, id);
    const updated = await this.prisma.review.update({
      where: { id },
      data: {
        status: ReviewStatus.APPROVED,
        ...(dto.verifiedSubscriber !== undefined && {
          verifiedSubscriber: dto.verifiedSubscriber,
        }),
      },
      select: { id: true, status: true, verifiedSubscriber: true },
    });
    // la reseña aprobada ya es visible en la PDP
    this.revalidation.dispatch(tenantSlug, [`product:${review.productSlug}`]);
    return updated;
  }

  async reject(tenantId: string, tenantSlug: string, id: string) {
    const review = await this.ensure(tenantId, id);
    const updated = await this.prisma.review.update({
      where: { id },
      data: { status: ReviewStatus.REJECTED },
      select: { id: true, status: true },
    });
    // si estaba aprobada y se rechaza, refrescar la PDP
    if (review.status === ReviewStatus.APPROVED) {
      this.revalidation.dispatch(tenantSlug, [`product:${review.productSlug}`]);
    }
    return updated;
  }

  async reply(
    tenantId: string,
    tenantSlug: string,
    id: string,
    dto: ReplyReviewDto,
  ) {
    const review = await this.ensure(tenantId, id);
    const updated = await this.prisma.review.update({
      where: { id },
      data: { reply: dto.reply ?? null },
      select: { id: true, reply: true },
    });
    if (review.status === ReviewStatus.APPROVED) {
      this.revalidation.dispatch(tenantSlug, [`product:${review.productSlug}`]);
    }
    return updated;
  }

  private async ensure(tenantId: string, id: string) {
    const review = await this.prisma.review.findFirst({
      where: { id, tenantId },
      select: { id: true, status: true, product: { select: { slug: true } } },
    });
    if (!review) throw new NotFoundException('Reseña no encontrada');
    return { ...review, productSlug: review.product.slug };
  }
}
