import { AdminSubscriptionsService } from './admin-subscriptions.service';
import { SubscriptionLifecycleService } from './subscription-lifecycle.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';

const flush = () => new Promise((r) => setImmediate(r));

describe('AdminSubscriptionsService · avisos al cliente', () => {
  const nextShipAt = new Date('2026-12-02T12:00:00Z');
  const sub = (overrides: Record<string, unknown> = {}) => ({
    id: 'sub-1',
    tenantId: 'tenant-1',
    frequencyDays: 30,
    nextShipAt,
    customer: { id: 'c-1', email: 'cliente@demo.co', name: 'Cliente Demo' },
    variant: { product: { name: 'Huila Supremo' } },
    ...overrides,
  });

  let prisma: {
    tenant: { findUnique: jest.Mock };
    subscription: { findFirst: jest.Mock };
  };
  let lifecycle: Record<string, jest.Mock>;
  let mail: { sendSubscriptionChanged: jest.Mock };
  let service: AdminSubscriptionsService;

  beforeEach(() => {
    prisma = {
      tenant: { findUnique: jest.fn().mockResolvedValue({ name: 'ORÍGEN' }) },
      subscription: { findFirst: jest.fn() },
    };
    lifecycle = {
      pause: jest.fn().mockResolvedValue(sub()),
      resume: jest.fn().mockResolvedValue(sub()),
      skipNext: jest.fn().mockResolvedValue(sub()),
      cancel: jest.fn().mockResolvedValue(sub()),
      updateTerms: jest.fn().mockResolvedValue(sub({ frequencyDays: 14 })),
    };
    mail = { sendSubscriptionChanged: jest.fn().mockResolvedValue(undefined) };
    service = new AdminSubscriptionsService(
      prisma as unknown as PrismaService,
      lifecycle as unknown as SubscriptionLifecycleService,
      mail as unknown as MailService,
    );
  });

  it.each([
    ['pause', 'paused'],
    ['resume', 'resumed'],
    ['skipNext', 'skipped'],
    ['cancel', 'cancelled'],
  ] as const)('%s envía el aviso "%s"', async (method, change) => {
    await service[method]('tenant-1', 'sub-1');
    await flush();

    expect(mail.sendSubscriptionChanged).toHaveBeenCalledWith({
      to: 'cliente@demo.co',
      customerName: 'Cliente Demo',
      tenantId: 'tenant-1',
      productName: 'Huila Supremo',
      change,
      frequencyDays: 30,
      nextShipAt,
    });
  });

  it('update avisa solo cuando la frecuencia cambia', async () => {
    prisma.subscription.findFirst.mockResolvedValueOnce({ frequencyDays: 30 });
    await service.update('tenant-1', 'sub-1', { frequencyDays: 14 });
    await flush();
    expect(mail.sendSubscriptionChanged).toHaveBeenCalledWith(
      expect.objectContaining({ change: 'frequency', frequencyDays: 14 }),
    );

    mail.sendSubscriptionChanged.mockClear();
    prisma.subscription.findFirst.mockResolvedValueOnce({ frequencyDays: 14 });
    await service.update('tenant-1', 'sub-1', { frequencyDays: 14 });
    await service.update('tenant-1', 'sub-1', { discountPct: 15 });
    await flush();
    expect(mail.sendSubscriptionChanged).not.toHaveBeenCalled();
  });

  it('un fallo del correo no rompe la acción', async () => {
    mail.sendSubscriptionChanged.mockRejectedValue(new Error('Resend caído'));
    await expect(service.pause('tenant-1', 'sub-1')).resolves.toMatchObject({
      id: 'sub-1',
    });
    await flush();
  });
});
