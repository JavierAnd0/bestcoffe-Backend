import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Vista de facturación del tenant + flujo de consentimiento de la comisión.
 * Lo consume el panel del operador (/admin); solo lectura salvo aceptar/rechazar
 * un cambio de comisión propuesto por la plataforma.
 */
@Injectable()
export class AdminBillingService {
  constructor(private readonly prisma: PrismaService) {}

  /** Cómo se le factura al tenant + propuesta de comisión pendiente (si hay). */
  async get(tenantId: string) {
    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        billingType: true,
        billingStatus: true,
        billingCycle: true,
        billingAmountCents: true,
        currentPeriodEnd: true,
        hasMaintenance: true,
        commissionPct: true,
        pendingCommissionPct: true,
        commissionPctProposedAt: true,
        commissionAcceptedAt: true,
      },
    });
    if (!t) throw new NotFoundException('Tenant no encontrado');

    return {
      ...t,
      // Conveniencia para el front: ¿hay un cambio de comisión por decidir?
      pendingCommission:
        t.pendingCommissionPct != null
          ? {
              currentPct: t.commissionPct,
              proposedPct: t.pendingCommissionPct,
              proposedAt: t.commissionPctProposedAt,
            }
          : null,
    };
  }

  /** El dueño acepta el % propuesto: pasa a ser el % activo. */
  async acceptCommission(tenantId: string) {
    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { pendingCommissionPct: true },
    });
    if (!t) throw new NotFoundException('Tenant no encontrado');
    if (t.pendingCommissionPct == null) {
      throw new BadRequestException('No hay un cambio de comisión pendiente');
    }

    return this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        commissionPct: t.pendingCommissionPct,
        commissionAcceptedAt: new Date(),
        pendingCommissionPct: null,
        commissionPctProposedAt: null,
      },
      select: { commissionPct: true, commissionAcceptedAt: true },
    });
  }

  /** El dueño rechaza el % propuesto: se conserva el % activo anterior. */
  async rejectCommission(tenantId: string) {
    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { pendingCommissionPct: true },
    });
    if (!t) throw new NotFoundException('Tenant no encontrado');
    if (t.pendingCommissionPct == null) {
      throw new BadRequestException('No hay un cambio de comisión pendiente');
    }

    return this.prisma.tenant.update({
      where: { id: tenantId },
      data: { pendingCommissionPct: null, commissionPctProposedAt: null },
      select: { commissionPct: true },
    });
  }
}
