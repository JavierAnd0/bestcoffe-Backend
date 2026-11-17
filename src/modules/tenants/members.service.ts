import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OperatorRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { AddMemberDto, UpdateMemberRoleDto } from './dto/member.dto';

@Injectable()
export class MembersService {
  private readonly logger = new Logger(MembersService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly mail?: MailService,
    @Optional() private readonly config?: ConfigService,
  ) {}

  /** Equipo del tenant con datos del usuario. */
  async list(tenantId: string) {
    const members = await this.prisma.tenantMembership.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
      select: {
        role: true,
        createdAt: true,
        user: { select: { id: true, email: true, name: true } },
      },
    });
    return members.map((m) => ({
      userId: m.user.id,
      email: m.user.email,
      name: m.user.name,
      role: m.role,
      createdAt: m.createdAt,
    }));
  }

  /** Agrega un operador (crea el User si no existe) con un rol asignable. */
  async add(tenantId: string, dto: AddMemberDto) {
    const user = await this.prisma.user.upsert({
      where: { email: dto.email },
      update: {},
      create: { email: dto.email, name: dto.name },
      select: { id: true, email: true, name: true },
    });

    const existing = await this.prisma.tenantMembership.findUnique({
      where: { userId_tenantId: { userId: user.id, tenantId } },
      select: { userId: true },
    });
    if (existing) {
      throw new BadRequestException('El usuario ya es miembro de este tenant');
    }

    await this.prisma.tenantMembership.create({
      data: { userId: user.id, tenantId, role: dto.role },
    });
    this.sendInvitation(tenantId, user.email, user.name, dto.role);
    return {
      userId: user.id,
      email: user.email,
      name: user.name,
      role: dto.role,
    };
  }

  /** Cambia el rol; protege que no quede el tenant sin ningún TENANT_OWNER. */
  async updateRole(tenantId: string, userId: string, dto: UpdateMemberRoleDto) {
    const membership = await this.ensure(tenantId, userId);

    if (
      membership.role === OperatorRole.TENANT_OWNER &&
      dto.role !== OperatorRole.TENANT_OWNER
    ) {
      await this.assertNotLastOwner(tenantId, userId);
    }

    const updated = await this.prisma.tenantMembership.update({
      where: { userId_tenantId: { userId, tenantId } },
      data: { role: dto.role },
      select: {
        role: true,
        user: { select: { id: true, email: true, name: true } },
      },
    });
    return {
      userId: updated.user.id,
      email: updated.user.email,
      name: updated.user.name,
      role: updated.role,
    };
  }

  /** Remueve a un operador; no permite borrar al último TENANT_OWNER. */
  async remove(tenantId: string, userId: string) {
    const membership = await this.ensure(tenantId, userId);

    if (membership.role === OperatorRole.TENANT_OWNER) {
      await this.assertNotLastOwner(tenantId, userId);
    }

    await this.prisma.tenantMembership.delete({
      where: { userId_tenantId: { userId, tenantId } },
    });
    return { userId, removed: true };
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private async ensure(tenantId: string, userId: string) {
    const membership = await this.prisma.tenantMembership.findUnique({
      where: { userId_tenantId: { userId, tenantId } },
      select: { role: true },
    });
    if (!membership) throw new NotFoundException('El usuario no es miembro');
    // La membresía de plataforma no la administra la tienda.
    if (membership.role === OperatorRole.PLATFORM_OWNER) {
      throw new ForbiddenException(
        'Ese acceso pertenece a la plataforma y no se puede cambiar desde la tienda',
      );
    }
    return membership;
  }

  /** Lanza si `userId` es el único TENANT_OWNER del tenant. */
  private async assertNotLastOwner(tenantId: string, userId: string) {
    const otherOwners = await this.prisma.tenantMembership.count({
      where: {
        tenantId,
        role: OperatorRole.TENANT_OWNER,
        NOT: { userId },
      },
    });
    if (otherOwners === 0) {
      throw new BadRequestException(
        'No puedes dejar al tenant sin ningún TENANT_OWNER',
      );
    }
  }

  /**
   * Correo de invitación con el enlace de acceso de la tienda. No firma un
   * token (expiraría antes de abrirse): el miembro pide su enlace mágico al
   * entrar. Si el correo falla, el alta sigue siendo válida.
   */
  private sendInvitation(
    tenantId: string,
    email: string,
    name: string | null,
    role: OperatorRole,
  ): void {
    if (!this.mail) return;
    const mail = this.mail;
    void this.prisma.tenant
      .findUnique({
        where: { id: tenantId },
        select: { name: true, slug: true },
      })
      .then((tenant) => {
        if (!tenant) return;
        return mail.sendMemberInvitation({
          to: email,
          name,
          storeName: tenant.name,
          roleLabel: ROLE_LABELS[role] ?? role,
          accessUrl: `${this.storeUrl(tenant.slug)}/acceso?email=${encodeURIComponent(email)}`,
        });
      })
      .catch((err: unknown) =>
        this.logger.warn(
          `No se pudo enviar la invitación a ${email}: ${String(err)}`,
        ),
      );
  }

  /** URL de la tienda: <slug>.<PLATFORM_DOMAIN> si está definido; si no, WEB_APP_URL. */
  private storeUrl(slug: string): string {
    const domain = process.env.PLATFORM_DOMAIN?.trim();
    if (domain) return `https://${slug}.${domain}`;
    return (
      this.config?.get<string>('webAppUrl') ??
      process.env.WEB_APP_URL ??
      'http://localhost:3000'
    ).replace(/\/$/, '');
  }
}

const ROLE_LABELS: Partial<Record<OperatorRole, string>> = {
  TENANT_OWNER: 'Dueño',
  TENANT_EDITOR: 'Editor (catálogo y contenido)',
  TENANT_ORDERS: 'Pedidos (pedidos y suscripciones)',
};
