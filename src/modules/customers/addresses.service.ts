import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAddressDto, UpdateAddressDto } from './dto/address.dto';

@Injectable()
export class AddressesService {
  constructor(private readonly prisma: PrismaService) {}

  list(customerId: string) {
    return this.prisma.address.findMany({
      where: { customerId },
      orderBy: [{ isDefault: 'desc' }, { id: 'asc' }],
    });
  }

  create(customerId: string, tenantId: string, dto: CreateAddressDto) {
    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.address.updateMany({
          where: { customerId, isDefault: true },
          data: { isDefault: false },
        });
      }
      return tx.address.create({
        data: {
          ...dto,
          country: dto.country ?? 'CO',
          isDefault: dto.isDefault ?? false,
          customerId,
          tenantId,
        },
      });
    });
  }

  async update(customerId: string, id: string, dto: UpdateAddressDto) {
    await this.ensureOwnership(customerId, id);
    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.address.updateMany({
          where: { customerId, isDefault: true, id: { not: id } },
          data: { isDefault: false },
        });
      }
      return tx.address.update({ where: { id }, data: dto });
    });
  }

  async remove(customerId: string, id: string) {
    await this.ensureOwnership(customerId, id);
    await this.prisma.address.delete({ where: { id } });
  }

  private async ensureOwnership(customerId: string, id: string) {
    const addr = await this.prisma.address.findFirst({
      where: { id, customerId },
      select: { id: true },
    });
    if (!addr) throw new NotFoundException('Dirección no encontrada');
    return addr;
  }
}
