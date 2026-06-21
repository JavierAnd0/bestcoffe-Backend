import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Prisma, Tier } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import type { JwtPayload } from '../../common/guards/auth.guard';
import { CreatePlatformTenantDto } from './dto/create-platform-tenant.dto';
import { UpdatePlatformTenantDto } from './dto/update-platform-tenant.dto';

@Injectable()
export class PlatformTenantsService {
  private readonly logger = new Logger(PlatformTenantsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
  ) {}

  async list() {
    return this.prisma.tenant.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        slug: true,
        name: true,
        tier: true,
        createdAt: true,
        billingType: true,
        billingStatus: true,
        billingCycle: true,
        currentPeriodEnd: true,
        hasMaintenance: true,
        billingAmountCents: true,
        commissionEnabled: true,
        commissionPct: true,
        pendingCommissionPct: true,
        _count: {
          select: { memberships: true, orders: true, customers: true },
        },
      },
    });
  }

  async create(dto: CreatePlatformTenantDto) {
    const existing = await this.prisma.tenant.findUnique({
      where: { slug: dto.slug },
      select: { id: true },
    });
    if (existing) throw new ConflictException(`El slug "${dto.slug}" ya está en uso`);

    const tier = dto.tier ?? Tier.STARTER;

    // La comisión solo puede habilitarse al crear, y solo en PRO/BUSINESS.
    if (dto.commissionEnabled && tier === Tier.STARTER) {
      throw new BadRequestException(
        'La comisión por ventas solo está disponible en planes PRO y BUSINESS',
      );
    }
    const commissionEnabled = dto.commissionEnabled ?? false;
    // Si se habilita con un % inicial, arranca directamente en modalidad comisión.
    const startsOnCommission =
      commissionEnabled && dto.commissionPct != null;

    const tenant = await this.prisma.$transaction(async (tx) => {
      const t = await tx.tenant.create({
        data: {
          slug: dto.slug,
          name: dto.name,
          tier,
          features: (dto.features as object) ?? {},
          // Arranca la facturación en la fecha de alta; el superadmin ajusta
          // modalidad/ciclo/fechas después desde el panel.
          billingStartedAt: new Date(),
          commissionEnabled,
          ...(startsOnCommission && {
            billingType: 'COMMISSION',
            commissionPct: dto.commissionPct,
            commissionAcceptedAt: new Date(),
          }),
        },
      });

      const owner = await tx.user.upsert({
        where: { email: dto.ownerEmail },
        update: {},
        create: { email: dto.ownerEmail, name: dto.ownerName },
        select: { id: true, email: true, name: true },
      });

      await tx.tenantMembership.create({
        data: { tenantId: t.id, userId: owner.id, role: 'TENANT_OWNER' },
      });

      if (dto.domain) {
        await tx.tenantDomain.create({
          data: { tenantId: t.id, domain: dto.domain, isPrimary: true },
        });
      }

      return { ...t, owner };
    });

    // Correo de bienvenida: el dueño accede por magic link de operador en
    // /acceso (prellenamos su email). No firmamos un token aquí para evitar que
    // expire antes de que abra el correo — él solicita el enlace al entrar.
    const webUrl =
      this.config.get<string>('webAppUrl') ?? 'http://localhost:3000';
    const accessUrl = `${webUrl}/acceso?email=${encodeURIComponent(dto.ownerEmail)}`;
    try {
      await this.mail.sendTenantWelcome(
        dto.ownerEmail,
        dto.ownerName,
        dto.name,
        accessUrl,
      );
    } catch (err) {
      // El alta del tenant no debe fallar si el correo no sale.
      this.logger.error(
        `No se pudo enviar el correo de bienvenida a ${dto.ownerEmail}`,
        err as Error,
      );
    }

    return tenant;
  }

  async findOne(id: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      include: {
        domains: true,
        memberships: {
          include: { user: { select: { id: true, email: true, name: true } } },
          orderBy: { createdAt: 'asc' },
        },
        _count: { select: { orders: true, customers: true, subscriptions: true } },
      },
    });
    if (!tenant) throw new NotFoundException('Tenant no encontrado');
    return tenant;
  }

  async update(id: string, dto: UpdatePlatformTenantDto) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        tier: true,
        features: true,
        branding: true,
        billingType: true,
        commissionEnabled: true,
        commissionPct: true,
      },
    });
    if (!tenant) throw new NotFoundException('Tenant no encontrado');

    const effectiveTier = dto.tier ?? tenant.tier;
    const effectiveType = dto.billingType ?? tenant.billingType;
    if (effectiveType === 'COMMISSION') {
      // La comisión debe haberse habilitado al crear el tenant…
      if (!tenant.commissionEnabled) {
        throw new BadRequestException(
          'La comisión por ventas solo puede habilitarse al crear el tenant',
        );
      }
      // …y solo aplica a PRO/BUSINESS.
      if (effectiveTier === Tier.STARTER) {
        throw new BadRequestException(
          'La comisión por ventas solo está disponible en planes PRO y BUSINESS',
        );
      }
    }

    // Comisión: el primer % se fija directo; cambiar uno existente crea una
    // propuesta que el dueño del tenant debe aceptar (el % activo no cambia).
    const commissionData: Prisma.TenantUpdateInput = {};
    let proposal: { oldPct: number; newPct: number } | null = null;
    if (dto.commissionPct !== undefined) {
      if (tenant.commissionPct == null) {
        commissionData.commissionPct = dto.commissionPct;
        commissionData.commissionAcceptedAt = new Date();
        commissionData.pendingCommissionPct = null;
        commissionData.commissionPctProposedAt = null;
      } else if (dto.commissionPct !== tenant.commissionPct) {
        commissionData.pendingCommissionPct = dto.commissionPct;
        commissionData.commissionPctProposedAt = new Date();
        proposal = { oldPct: tenant.commissionPct, newPct: dto.commissionPct };
      }
    }

    // Fechas: llegan como ISO string o null (para limpiar). `undefined` = no tocar.
    const toDate = (v: string | null | undefined) =>
      v === undefined ? undefined : v === null ? null : new Date(v);

    const updated = await this.prisma.tenant.update({
      where: { id },
      data: {
        ...(dto.tier && { tier: dto.tier }),
        ...(dto.features && {
          features: { ...(tenant.features as object), ...dto.features } as Prisma.InputJsonValue,
        }),
        ...(dto.branding && {
          branding: { ...(tenant.branding as object), ...dto.branding } as Prisma.InputJsonValue,
        }),
        // Facturación
        ...(dto.billingType && { billingType: dto.billingType }),
        ...(dto.billingStatus && { billingStatus: dto.billingStatus }),
        ...(dto.billingCycle !== undefined && { billingCycle: dto.billingCycle }),
        ...(dto.billingStartedAt !== undefined && {
          billingStartedAt: toDate(dto.billingStartedAt),
        }),
        ...(dto.currentPeriodEnd !== undefined && {
          currentPeriodEnd: toDate(dto.currentPeriodEnd),
        }),
        ...(dto.cancelledAt !== undefined && {
          cancelledAt: toDate(dto.cancelledAt),
        }),
        ...(dto.hasMaintenance !== undefined && {
          hasMaintenance: dto.hasMaintenance,
        }),
        ...(dto.billingAmountCents !== undefined && {
          billingAmountCents: dto.billingAmountCents,
        }),
        ...commissionData,
      },
    });

    // Notificar al dueño del tenant si hay un cambio de % que debe aprobar.
    if (proposal) {
      await this.notifyCommissionProposal(id, tenant.name, proposal);
    }

    return updated;
  }

  /** Envía al dueño del tenant la propuesta de cambio de comisión (best-effort). */
  private async notifyCommissionProposal(
    tenantId: string,
    storeName: string,
    proposal: { oldPct: number; newPct: number },
  ) {
    const owner = await this.prisma.tenantMembership.findFirst({
      where: { tenantId, role: 'TENANT_OWNER' },
      include: { user: { select: { email: true } } },
      orderBy: { createdAt: 'asc' },
    });
    if (!owner) return;

    const webUrl = this.config.get<string>('webAppUrl') ?? 'http://localhost:3000';
    const panelUrl = `${webUrl}/admin`;
    try {
      await this.mail.sendCommissionChangeProposal(
        owner.user.email,
        storeName,
        proposal.oldPct,
        proposal.newPct,
        panelUrl,
      );
    } catch (err) {
      this.logger.error(
        `No se pudo notificar el cambio de comisión a ${owner.user.email}`,
        err as Error,
      );
    }
  }

  async impersonate(id: string): Promise<{ accessToken: string }> {
    const membership = await this.prisma.tenantMembership.findFirst({
      where: { tenantId: id, role: 'TENANT_OWNER' },
      include: { user: { select: { id: true, email: true } } },
      orderBy: { createdAt: 'asc' },
    });
    if (!membership) throw new NotFoundException('No hay TENANT_OWNER en este tenant');

    const payload: JwtPayload = {
      sub: membership.user.id,
      email: membership.user.email,
      type: 'operator',
    };
    const accessToken = await this.jwt.signAsync(payload, { expiresIn: '2h' });
    return { accessToken };
  }
}
