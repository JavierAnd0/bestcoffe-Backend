import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateCustomerDto } from './dto/update-customer.dto';

const ME_SELECT = {
  id: true,
  email: true,
  name: true,
  phone: true,
  emailVerified: true,
  newsletterOptIn: true,
  createdAt: true,
  addresses: {
    select: {
      id: true,
      label: true,
      line1: true,
      line2: true,
      city: true,
      state: true,
      postalCode: true,
      country: true,
      phone: true,
      isDefault: true,
    },
  },
} as const;

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async getMe(customerId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: ME_SELECT,
    });

    if (!customer) throw new NotFoundException('Cliente no encontrado');
    return customer;
  }

  /**
   * Actualiza los datos propios del cliente. El correo no es editable aquí.
   * Si cambia la preferencia de newsletter se guarda cuándo ocurrió.
   */
  async updateMe(customerId: string, dto: UpdateCustomerDto) {
    const exists = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Cliente no encontrado');

    return this.prisma.customer.update({
      where: { id: customerId },
      data: {
        ...(dto.name !== undefined && { name: dto.name.trim() }),
        ...(dto.phone !== undefined && { phone: dto.phone.trim() || null }),
        ...(dto.newsletterOptIn !== undefined && {
          newsletterOptIn: dto.newsletterOptIn,
          newsletterUpdatedAt: new Date(),
        }),
      },
      select: ME_SELECT,
    });
  }
}
