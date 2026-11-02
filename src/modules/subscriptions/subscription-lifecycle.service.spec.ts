import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SubStatus } from '@prisma/client';
import { SubscriptionLifecycleService } from './subscription-lifecycle.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('SubscriptionLifecycleService', () => {
  let service: SubscriptionLifecycleService;
  let prisma: {
    subscription: {
      findFirst: jest.Mock;
      update: jest.Mock;
    };
  };

  beforeEach(() => {
    prisma = {
      subscription: {
        findFirst: jest.fn(),
        update: jest.fn().mockImplementation(({ data }: { data: unknown }) => ({
          id: 'sub-1',
          ...(data as Record<string, unknown>),
        })),
      },
    };
    service = new SubscriptionLifecycleService(
      prisma as unknown as PrismaService,
    );
  });

  it('lanza NotFoundException si la suscripción no pertenece al scope dado', async () => {
    prisma.subscription.findFirst.mockResolvedValue(null);

    await expect(
      service.pause({ id: 'sub-1', customerId: 'cust-1' }, { id: true }),
    ).rejects.toThrow(NotFoundException);
  });

  it('pause: permite pausar desde ACTIVE o PAYMENT_FAILED pero rechaza si ya está PAUSED o CANCELLED', async () => {
    prisma.subscription.findFirst.mockResolvedValueOnce({
      id: 'sub-1',
      status: SubStatus.PAYMENT_FAILED,
      nextShipAt: new Date(),
      frequencyDays: 14,
    });

    const paused = await service.pause(
      { id: 'sub-1', tenantId: 'ten-1' },
      { id: true, status: true },
    );
    expect(paused.status).toBe(SubStatus.PAUSED);

    prisma.subscription.findFirst.mockResolvedValueOnce({
      id: 'sub-1',
      status: SubStatus.CANCELLED,
      nextShipAt: new Date(),
      frequencyDays: 14,
    });
    await expect(
      service.pause({ id: 'sub-1', tenantId: 'ten-1' }, { id: true }),
    ).rejects.toThrow(BadRequestException);
  });

  it('resume: reprograma nextShipAt hacia el futuro si la fecha había quedado en el pasado', async () => {
    const pastDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    prisma.subscription.findFirst.mockResolvedValue({
      id: 'sub-1',
      status: SubStatus.PAUSED,
      nextShipAt: pastDate,
      frequencyDays: 15,
    });

    const resumed = (await service.resume(
      { id: 'sub-1', customerId: 'cust-1' },
      { id: true, status: true, nextShipAt: true },
    )) as unknown as { status: SubStatus; nextShipAt: Date };

    expect(resumed.status).toBe(SubStatus.ACTIVE);
    expect(resumed.nextShipAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('skipNext: adelanta nextShipAt en una frecuencia y pasa a SKIPPED_NEXT', async () => {
    const baseDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    prisma.subscription.findFirst.mockResolvedValue({
      id: 'sub-1',
      status: SubStatus.ACTIVE,
      nextShipAt: baseDate,
      frequencyDays: 14,
    });

    const skipped = (await service.skipNext(
      { id: 'sub-1', customerId: 'cust-1' },
      { id: true, status: true, nextShipAt: true },
    )) as unknown as { status: SubStatus; nextShipAt: Date };

    expect(skipped.status).toBe(SubStatus.SKIPPED_NEXT);
    expect(skipped.nextShipAt.getTime() - baseDate.getTime()).toBe(
      14 * 24 * 60 * 60 * 1000,
    );
  });
});

