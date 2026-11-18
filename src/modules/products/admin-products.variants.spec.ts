import { ConflictException, NotFoundException } from '@nestjs/common';
import { AdminProductsService } from './admin-products.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { RevalidationService } from '../revalidation/revalidation.service';

function setup(counts: { live?: number; past?: number; gifts?: number } = {}) {
  const prisma = {
    productVariant: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: 'v1', product: { slug: 'cafe' } }),
      delete: jest.fn().mockResolvedValue({}),
      update: jest
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
          id: 'v1',
          ...data,
        })),
    },
    subscription: {
      count: jest
        .fn()
        .mockImplementation(({ where }: { where: { status: unknown } }) =>
          where.status === 'CANCELLED'
            ? (counts.past ?? 0)
            : (counts.live ?? 0),
        ),
    },
    giftSubscription: { count: jest.fn().mockResolvedValue(counts.gifts ?? 0) },
  };
  const revalidation = { dispatch: jest.fn() };
  const svc = new AdminProductsService(
    prisma as unknown as PrismaService,
    revalidation as unknown as RevalidationService,
  );
  return { svc, prisma, revalidation };
}

describe('AdminProductsService · variantes', () => {
  it('borra una variante sin suscripciones ni regalos', async () => {
    const { svc, prisma, revalidation } = setup();
    await expect(svc.removeVariant('t1', 'demo', 'v1')).resolves.toEqual({
      id: 'v1',
      deleted: true,
    });
    expect(prisma.productVariant.delete).toHaveBeenCalledWith({
      where: { id: 'v1' },
    });
    expect(revalidation.dispatch).toHaveBeenCalledWith('demo', [
      'product:cafe',
    ]);
  });

  it('con suscripciones vigentes responde 409 explicando qué hacer', async () => {
    const { svc, prisma } = setup({ live: 2 });
    await expect(svc.removeVariant('t1', 'demo', 'v1')).rejects.toThrow(
      /2 suscripción\(es\) vigente\(s\)/,
    );
    expect(prisma.productVariant.delete).not.toHaveBeenCalled();
  });

  it('con solo historial (canceladas o regalos) responde 409 sin tocar la base', async () => {
    for (const counts of [{ past: 1 }, { gifts: 1 }]) {
      const { svc, prisma } = setup(counts);
      await expect(
        svc.removeVariant('t1', 'demo', 'v1'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.productVariant.delete).not.toHaveBeenCalled();
    }
  });

  it('las cuentas se limitan a la tienda', async () => {
    const { svc, prisma } = setup();
    await svc.removeVariant('t1', 'demo', 'v1');
    for (const [arg] of prisma.subscription.count.mock.calls as [
      { where: { tenantId: string } },
    ][]) {
      expect(arg.where.tenantId).toBe('t1');
    }
  });

  it('variante de otra tienda: 404', async () => {
    const { svc, prisma } = setup();
    prisma.productVariant.findFirst.mockResolvedValue(null);
    await expect(svc.removeVariant('t1', 'demo', 'v1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('priceSubscription null quita el precio de suscripción', async () => {
    const { svc, prisma } = setup();
    await svc.updateVariant('t1', 'demo', 'v1', { priceSubscription: null });
    expect(prisma.productVariant.update).toHaveBeenCalledWith({
      where: { id: 'v1' },
      data: { priceSubscription: null },
    });
  });
});
