import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ListAuditLogsDto } from './dto/list-audit-logs.dto';

export interface ActorInfo {
  id: string;
  email: string | null;
  name: string | null;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Bitácora del tenant con filtros y paginación keyset (createdAt desc).
   * `AuditLog.userId` no tiene relación Prisma con User, así que el actor se
   * enriquece con una segunda consulta y se mapea en memoria.
   */
  async list(tenantId: string, dto: ListAuditLogsDto) {
    const limit = dto.limit ?? 25;

    const where: Prisma.AuditLogWhereInput = {
      tenantId,
      ...(dto.entity && { entity: dto.entity }),
      ...(dto.entityId && { entityId: dto.entityId }),
      ...(dto.userId && { userId: dto.userId }),
      ...(dto.action && { action: dto.action }),
      ...((dto.from || dto.to) && {
        createdAt: {
          ...(dto.from && { gte: new Date(dto.from) }),
          ...(dto.to && { lte: new Date(dto.to) }),
        },
      }),
    };

    const rows = await this.prisma.auditLog.findMany({
      where,
      take: limit + 1,
      ...(dto.cursor && { cursor: { id: dto.cursor }, skip: 1 }),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const actors = await this.actorsById(page.map((r) => r.userId));

    return {
      items: page.map((r) => ({
        ...r,
        actor: actors.get(r.userId) ?? { id: r.userId, email: null, name: null },
      })),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  async findOne(tenantId: string, id: string) {
    const log = await this.prisma.auditLog.findFirst({ where: { id, tenantId } });
    if (!log) throw new NotFoundException('Registro de auditoría no encontrado');
    const actors = await this.actorsById([log.userId]);
    return {
      ...log,
      actor: actors.get(log.userId) ?? { id: log.userId, email: null, name: null },
    };
  }

  /** Resuelve {id → {id,email,name}} para un conjunto de userIds. */
  private async actorsById(userIds: string[]) {
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return new Map<string, ActorInfo>();
    const users = await this.prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, email: true, name: true },
    });
    return new Map<string, ActorInfo>(users.map((u) => [u.id, u]));
  }
}
