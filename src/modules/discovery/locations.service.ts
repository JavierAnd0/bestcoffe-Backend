import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class LocationsService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string) {
    return this.prisma.storeLocation.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
    });
  }
}
