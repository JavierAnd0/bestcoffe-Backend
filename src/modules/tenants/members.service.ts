import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OperatorRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AddMemberDto, UpdateMemberRoleDto } from './dto/member.dto';

@Injectable()
export class MembersService {
  constructor(private readonly prisma: PrismaService) {}

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
    return { userId: user.id, email: user.email, name: user.name, role: dto.role };
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
}
