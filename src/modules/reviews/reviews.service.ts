import { Injectable, NotFoundException } from '@nestjs/common';
import { ProductStatus, ReviewStatus, SubStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateReviewDto } from './dto/create-review.dto';

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Alta de reseña desde el storefront. Queda en PENDING (moderación admin).
   * Marca verifiedSubscriber si el cliente tiene una suscripción activa.
   */
  async create(tenantId: string, dto: CreateReviewDto) {
    const product = await this.prisma.product.findFirst({
      where: { tenantId, slug: dto.productSlug, status: ProductStatus.ACTIVE },
      select: { id: true },
    });
    if (!product) {
      throw new NotFoundException(`Producto "${dto.productSlug}" no encontrado`);
    }

    const email = dto.email.toLowerCase().trim();
    const customer = await this.prisma.customer.upsert({
      where: { tenantId_email: { tenantId, email } },
      update: { ...(dto.name && { name: dto.name }) },
      create: { tenantId, email, name: dto.name },
      select: { id: true },
    });

    const activeSub = await this.prisma.subscription.findFirst({
      where: {
        tenantId,
        customerId: customer.id,
        status: SubStatus.ACTIVE,
      },
      select: { id: true },
    });

    const review = await this.prisma.review.create({
      data: {
        tenantId,
        productId: product.id,
        customerId: customer.id,
        rating: dto.rating,
        title: dto.title,
        body: dto.body,
        status: ReviewStatus.PENDING,
        verifiedSubscriber: !!activeSub,
      },
      select: { id: true, status: true, verifiedSubscriber: true },
    });

    return {
      ...review,
      message: 'Reseña recibida. Será publicada tras moderación.',
    };
  }
}
