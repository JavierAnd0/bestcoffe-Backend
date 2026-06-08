import { Injectable } from '@nestjs/common';
import { ProductStatus, ProductType, SubAvail } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { QuizAnswersDto, RoastPreference } from './dto/quiz-answers.dto';

// Rango de tostado objetivo por preferencia (escala 1..9).
const ROAST_RANGE: Record<RoastPreference, [number, number]> = {
  LIGHT: [1, 3],
  MEDIUM: [4, 6],
  DARK: [7, 9],
};

// Pesos del scoring.
const W_FLAVOR = 3;
const W_ROAST = 2;
const W_TYPE = 2;

@Injectable()
export class QuizService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Recomienda productos puntuando matching de notas/tostado/tipo/decaf.
   * Determinista y barato: se hace en memoria sobre el catálogo activo del
   * tenant (decenas de productos en el MVP).
   */
  async recommend(tenantId: string, answers: QuizAnswersDto) {
    const wantsDecaf = answers.decaf === true;

    const candidates = await this.prisma.product.findMany({
      where: {
        tenantId,
        status: ProductStatus.ACTIVE,
        subscriptionAvailability: { not: SubAvail.SUBSCRIPTION_ONLY },
        // si pide decaf, solo DECAF; si no, lo excluimos
        ...(wantsDecaf
          ? { type: ProductType.DECAF }
          : { type: { not: ProductType.DECAF } }),
      },
      select: {
        id: true,
        slug: true,
        name: true,
        type: true,
        origin: true,
        roastLevel: true,
        flavorNotes: true,
        badges: true,
        images: { orderBy: { position: 'asc' }, take: 1 },
        variants: {
          orderBy: { sizeGrams: 'asc' },
          take: 1,
          select: {
            id: true,
            sizeGrams: true,
            grind: true,
            priceOneTime: true,
            priceSubscription: true,
          },
        },
      },
    });

    const wantedNotes = (answers.flavorNotes ?? []).map((n) =>
      n.toLowerCase().trim(),
    );

    const scored = candidates
      .map((p) => ({ product: p, score: this.score(p, answers, wantedNotes) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, answers.limit ?? 3);

    return {
      recommendations: scored.map((s) => ({ ...s.product, matchScore: s.score })),
    };
  }

  private score(
    p: { roastLevel: number; type: ProductType; flavorNotes: string[] },
    answers: QuizAnswersDto,
    wantedNotes: string[],
  ): number {
    let score = 0;

    // Notas: overlap.
    if (wantedNotes.length) {
      const productNotes = p.flavorNotes.map((n) => n.toLowerCase());
      const overlap = wantedNotes.filter((n) =>
        productNotes.some((pn) => pn.includes(n) || n.includes(pn)),
      ).length;
      score += overlap * W_FLAVOR;
    }

    // Tostado: cercanía al rango preferido.
    if (answers.roast) {
      const [lo, hi] = ROAST_RANGE[answers.roast];
      if (p.roastLevel >= lo && p.roastLevel <= hi) {
        score += W_ROAST * 2;
      } else {
        const dist = Math.min(
          Math.abs(p.roastLevel - lo),
          Math.abs(p.roastLevel - hi),
        );
        score += Math.max(0, W_ROAST - dist);
      }
    }

    // Tipo.
    if (answers.type && p.type === answers.type) {
      score += W_TYPE;
    }

    return score;
  }
}
