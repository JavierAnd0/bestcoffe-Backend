import { ReviewsService } from './reviews.service';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * Una reseña anónima no puede modificar un cliente existente (auditoría #7):
 * antes sobrescribía su nombre con solo conocer su correo.
 */
describe('ReviewsService.create · clientes existentes', () => {
  it('no cambia el nombre de un cliente que ya existe', async () => {
    const prisma = {
      product: { findFirst: jest.fn().mockResolvedValue({ id: 'p1' }) },
      customer: { upsert: jest.fn().mockResolvedValue({ id: 'c1' }) },
      subscription: { findFirst: jest.fn().mockResolvedValue(null) },
      review: {
        create: jest.fn().mockResolvedValue({
          id: 'r1',
          status: 'PENDING',
          verifiedSubscriber: false,
        }),
      },
    };
    const svc = new ReviewsService(prisma as unknown as PrismaService);

    await svc.create('t1', {
      productSlug: 'cafe',
      email: 'Cliente@Correo.test ',
      name: '<b>Otro nombre</b>',
      rating: 5,
      body: 'Muy bueno',
    });

    const [arg] = prisma.customer.upsert.mock.calls[0] as [
      {
        where: unknown;
        update: Record<string, unknown>;
        create: Record<string, unknown>;
      },
    ];
    expect(arg.where).toEqual({
      tenantId_email: { tenantId: 't1', email: 'cliente@correo.test' },
    });
    expect(arg.update).toEqual({});
    // Un correo nuevo sí crea el cliente con el nombre dado.
    expect(arg.create).toMatchObject({ name: '<b>Otro nombre</b>' });
  });
});
