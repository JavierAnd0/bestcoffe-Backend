import {
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

    const tenant = await this.prisma.$transaction(async (tx) => {
      const t = await tx.tenant.create({
        data: {
          slug: dto.slug,
          name: dto.name,
          tier: dto.tier ?? Tier.STARTER,
          features: (dto.features as object) ?? {},
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
      select: { id: true, features: true, branding: true },
    });
    if (!tenant) throw new NotFoundException('Tenant no encontrado');

    return this.prisma.tenant.update({
      where: { id },
      data: {
        ...(dto.tier && { tier: dto.tier }),
        ...(dto.features && {
          features: { ...(tenant.features as object), ...dto.features } as Prisma.InputJsonValue,
        }),
        ...(dto.branding && {
          branding: { ...(tenant.branding as object), ...dto.branding } as Prisma.InputJsonValue,
        }),
      },
    });
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
