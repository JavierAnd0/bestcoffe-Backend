import { CustomersService } from './customers.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { NotFoundException } from '@nestjs/common';

type UpdateData = Record<string, unknown>;

function updateData(prisma: { customer: { update: jest.Mock } }): UpdateData {
  return (prisma.customer.update.mock.calls as [{ data: UpdateData }][])[0][0]
    .data;
}

function makePrisma(existing: boolean) {
  return {
    customer: {
      findUnique: jest.fn().mockResolvedValue(existing ? { id: 'c1' } : null),
      update: jest
        .fn()
        .mockImplementation(({ data }) =>
          Promise.resolve({ id: 'c1', ...data }),
        ),
    },
  };
}

describe('CustomersService.updateMe', () => {
  it('guarda la preferencia de newsletter y cuándo cambió', async () => {
    const prisma = makePrisma(true);
    const svc = new CustomersService(prisma as unknown as PrismaService);

    await svc.updateMe('c1', { newsletterOptIn: false });

    const data = updateData(prisma);
    expect(data.newsletterOptIn).toBe(false);
    expect(data.newsletterUpdatedAt).toBeInstanceOf(Date);
  });

  it('no toca la preferencia si no viene en la petición', async () => {
    const prisma = makePrisma(true);
    const svc = new CustomersService(prisma as unknown as PrismaService);

    await svc.updateMe('c1', { name: '  Ana Gómez ' });

    const data = updateData(prisma);
    expect(data.name).toBe('Ana Gómez');
    expect(data).not.toHaveProperty('newsletterOptIn');
    expect(data).not.toHaveProperty('newsletterUpdatedAt');
  });

  it('un teléfono vacío lo borra (null)', async () => {
    const prisma = makePrisma(true);
    const svc = new CustomersService(prisma as unknown as PrismaService);

    await svc.updateMe('c1', { phone: '   ' });

    expect(updateData(prisma).phone).toBeNull();
  });

  it('falla con 404 si el cliente no existe', async () => {
    const svc = new CustomersService(
      makePrisma(false) as unknown as PrismaService,
    );
    await expect(svc.updateMe('x', { name: 'A' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
