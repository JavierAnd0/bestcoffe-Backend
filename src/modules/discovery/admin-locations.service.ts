import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RevalidationService } from '../revalidation/revalidation.service';
import { CreateLocationDto, UpdateLocationDto } from './dto/save-location.dto';

/**
 * Administración de las sedes físicas de la tienda. Toda consulta filtra por
 * `tenantId`: un id de otra tienda responde 404.
 */
@Injectable()
export class AdminLocationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly revalidation: RevalidationService,
  ) {}

  list(tenantId: string) {
    return this.prisma.storeLocation.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
    });
  }

  findOne(tenantId: string, id: string) {
    return this.ensure(tenantId, id);
  }

  async create(tenantId: string, tenantSlug: string, dto: CreateLocationDto) {
    const location = await this.prisma.storeLocation.create({
      data: {
        tenantId,
        name: dto.name.trim(),
        address: dto.address.trim(),
        city: dto.city.trim(),
        phone: emptyToNull(dto.phone),
        hours: hoursValue(dto.hours),
        lat: dto.lat ?? null,
        lng: dto.lng ?? null,
      },
    });
    this.revalidate(tenantSlug);
    return location;
  }

  async update(
    tenantId: string,
    tenantSlug: string,
    id: string,
    dto: UpdateLocationDto,
  ) {
    const existing = await this.ensure(tenantId, id);
    const location = await this.prisma.storeLocation.update({
      where: { id: existing.id },
      data: {
        ...(dto.name !== undefined && { name: dto.name.trim() }),
        ...(dto.address !== undefined && { address: dto.address.trim() }),
        ...(dto.city !== undefined && { city: dto.city.trim() }),
        ...(dto.phone !== undefined && { phone: emptyToNull(dto.phone) }),
        ...(dto.hours !== undefined && { hours: hoursValue(dto.hours) }),
        ...(dto.lat !== undefined && { lat: dto.lat }),
        ...(dto.lng !== undefined && { lng: dto.lng }),
      },
    });
    this.revalidate(tenantSlug);
    return location;
  }

  async remove(tenantId: string, tenantSlug: string, id: string) {
    const existing = await this.ensure(tenantId, id);
    await this.prisma.storeLocation.delete({ where: { id: existing.id } });
    this.revalidate(tenantSlug);
    return { id: existing.id, deleted: true };
  }

  private async ensure(tenantId: string, id: string) {
    const location = await this.prisma.storeLocation.findFirst({
      where: { id, tenantId },
    });
    if (!location) throw new NotFoundException('Sede no encontrada');
    return location;
  }

  private revalidate(tenantSlug: string) {
    this.revalidation.dispatch(tenantSlug, ['locations']);
  }
}

function emptyToNull(value: string | null | undefined): string | null {
  const v = value?.trim();
  return v ? v : null;
}

/** `hours` es Json en el modelo; la tienda lo muestra como texto. */
function hoursValue(
  value: string | null | undefined,
): string | typeof Prisma.DbNull {
  return emptyToNull(value) ?? Prisma.DbNull;
}
