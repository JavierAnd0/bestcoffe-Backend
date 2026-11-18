import { Injectable, NotFoundException } from '@nestjs/common';
import { SubStatus } from '@prisma/client';
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

  /**
   * Elimina la cuenta del cliente ("Eliminar mi cuenta"). Los pedidos se
   * conservan (son registros de venta de la tienda), así que la fila del
   * cliente no se borra: se anonimiza. En una sola transacción:
   * - cancela sus suscripciones (no se generan más envíos ni pedidos);
   * - borra direcciones y carrito;
   * - reemplaza el correo y borra nombre, teléfono, notas y credenciales;
   * - marca deletedAt, con lo que el guard rechaza sus sesiones abiertas.
   */
  async deleteMe(customerId: string): Promise<{ deleted: true }> {
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const found = await tx.customer.findUnique({
        where: { id: customerId },
        select: { id: true, deletedAt: true },
      });
      if (!found || found.deletedAt) {
        throw new NotFoundException('Cliente no encontrado');
      }
      await tx.subscription.updateMany({
        where: { customerId, status: { not: SubStatus.CANCELLED } },
        data: { status: SubStatus.CANCELLED },
      });
      await tx.address.deleteMany({ where: { customerId } });
      await tx.cartItem.deleteMany({ where: { customerId } });
      await tx.customer.update({
        where: { id: customerId },
        data: {
          // Único por tienda y no entregable: libera el correo real para que
          // la persona pueda volver a registrarse si quiere.
          email: `eliminado+${customerId}@deleted.invalid`,
          name: null,
          phone: null,
          notes: null,
          stripeCustomerId: null,
          passwordHash: null,
          emailVerified: false,
          emailVerifyToken: null,
          emailVerifyExpiresAt: null,
          passwordResetToken: null,
          passwordResetExpiresAt: null,
          failedAttempts: 0,
          lockedUntil: null,
          newsletterOptIn: false,
          newsletterUpdatedAt: now,
          deletedAt: now,
        },
      });
    });
    return { deleted: true };
  }

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
