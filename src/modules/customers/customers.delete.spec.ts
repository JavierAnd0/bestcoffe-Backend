import { NotFoundException } from '@nestjs/common';
import { CustomersService } from './customers.service';
import type { PrismaService } from '../../prisma/prisma.service';

/** "Eliminar mi cuenta" (auditoría #9): antes no hacía nada en el backend. */
describe('CustomersService.deleteMe', () => {
  function build(found: { id: string; deletedAt: Date | null } | null) {
    const tx = {
      customer: {
        findUnique: jest.fn().mockResolvedValue(found),
        update: jest.fn().mockResolvedValue({}),
      },
      subscription: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
      address: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      cartItem: { deleteMany: jest.fn().mockResolvedValue({ count: 3 }) },
    };
    const prisma = {
      $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    return {
      svc: new CustomersService(prisma as unknown as PrismaService),
      tx,
    };
  }

  it('cancela suscripciones, borra direcciones y carrito, y anonimiza al cliente', async () => {
    const { svc, tx } = build({ id: 'c1', deletedAt: null });

    await expect(svc.deleteMe('c1')).resolves.toEqual({ deleted: true });

    expect(tx.subscription.updateMany).toHaveBeenCalledWith({
      where: { customerId: 'c1', status: { not: 'CANCELLED' } },
      data: { status: 'CANCELLED' },
    });
    expect(tx.address.deleteMany).toHaveBeenCalledWith({
      where: { customerId: 'c1' },
    });
    expect(tx.cartItem.deleteMany).toHaveBeenCalledWith({
      where: { customerId: 'c1' },
    });
    const [arg] = tx.customer.update.mock.calls[0] as [
      { where: unknown; data: Record<string, unknown> },
    ];
    expect(arg.where).toEqual({ id: 'c1' });
    expect(arg.data).toMatchObject({
      email: 'eliminado+c1@deleted.invalid',
      name: null,
      phone: null,
      passwordHash: null,
      emailVerified: false,
      newsletterOptIn: false,
    });
    expect(arg.data.deletedAt).toBeInstanceOf(Date);
  });

  it('una cuenta ya eliminada no se vuelve a procesar', async () => {
    const { svc, tx } = build({ id: 'c1', deletedAt: new Date() });
    await expect(svc.deleteMe('c1')).rejects.toThrow(NotFoundException);
    expect(tx.customer.update).not.toHaveBeenCalled();
  });
});
