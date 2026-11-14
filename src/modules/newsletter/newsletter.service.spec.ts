import { NewsletterService } from './newsletter.service';
import type { PrismaService } from '../../prisma/prisma.service';

type UpsertArg = {
  where: unknown;
  update: unknown;
  create: unknown;
};

function upsertArg(prisma: { newsletterSubscriber: { upsert: jest.Mock } }) {
  return (prisma.newsletterSubscriber.upsert.mock.calls as [UpsertArg][])[0][0];
}

function makePrisma(opts: {
  features?: unknown;
  customer?: { id: string } | null;
  discount?: Record<string, unknown> | null;
}) {
  return {
    tenant: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ features: opts.features ?? {} }),
    },
    customer: {
      findUnique: jest.fn().mockResolvedValue(opts.customer ?? null),
    },
    discountCode: {
      findUnique: jest.fn().mockResolvedValue(opts.discount ?? null),
    },
    newsletterSubscriber: { upsert: jest.fn().mockResolvedValue({}) },
  };
}

const asPrisma = (p: ReturnType<typeof makePrisma>) =>
  p as unknown as PrismaService;

describe('NewsletterService.subscribe', () => {
  it('registra al visitante sin cuenta', async () => {
    const prisma = makePrisma({});
    const svc = new NewsletterService(asPrisma(prisma));

    const res = await svc.subscribe('t1', { email: 'a@b.co', source: 'popup' });

    expect(prisma.newsletterSubscriber.upsert).toHaveBeenCalledTimes(1);
    const arg = upsertArg(prisma);
    expect(arg.where).toEqual({
      tenantId_email: { tenantId: 't1', email: 'a@b.co' },
    });
    expect(res.welcomeOffer).toBeNull(); // el tenant no configuró cupón
  });

  it('NUNCA reactiva a quien ya se dio de baja (update vacío)', async () => {
    const prisma = makePrisma({});
    const svc = new NewsletterService(asPrisma(prisma));

    await svc.subscribe('t1', { email: 'a@b.co' });

    const arg = upsertArg(prisma);
    expect(arg.update).toEqual({});
  });

  it('no duplica a clientes con cuenta (ya están suscritos por defecto)', async () => {
    const prisma = makePrisma({ customer: { id: 'c1' } });
    const svc = new NewsletterService(asPrisma(prisma));

    const res = await svc.subscribe('t1', { email: 'cliente@b.co' });

    expect(prisma.newsletterSubscriber.upsert).not.toHaveBeenCalled();
    // misma respuesta que para un visitante nuevo: no se enumeran cuentas
    expect(res.message).toMatch(/comunidad/i);
  });

  it('devuelve la oferta solo si el cupón existe, está activo y vigente', async () => {
    const prisma = makePrisma({
      features: { newsletter: { popupEnabled: true, welcomeCode: 'hola10' } },
      discount: {
        code: 'HOLA10',
        type: 'PERCENTAGE',
        value: 10,
        active: true,
        startsAt: null,
        endsAt: null,
        maxRedemptions: null,
        timesRedeemed: 0,
      },
    });
    const svc = new NewsletterService(asPrisma(prisma));

    const res = await svc.subscribe('t1', { email: 'a@b.co' });

    expect(res.welcomeOffer).toEqual({
      code: 'HOLA10',
      label: '10% de descuento',
    });
  });

  it('no promociona un cupón vencido o agotado', async () => {
    const base = {
      code: 'HOLA10',
      type: 'PERCENTAGE',
      value: 10,
      active: true,
      startsAt: null,
      maxRedemptions: null,
      timesRedeemed: 0,
    };
    const features = { newsletter: { welcomeCode: 'HOLA10' } };

    const expired = new NewsletterService(
      asPrisma(
        makePrisma({
          features,
          discount: { ...base, endsAt: new Date(Date.now() - 1000) },
        }),
      ),
    );
    expect(
      (await expired.subscribe('t1', { email: 'a@b.co' })).welcomeOffer,
    ).toBeNull();

    const exhausted = new NewsletterService(
      asPrisma(
        makePrisma({
          features,
          discount: {
            ...base,
            endsAt: null,
            maxRedemptions: 5,
            timesRedeemed: 5,
          },
        }),
      ),
    );
    expect(
      (await exhausted.subscribe('t1', { email: 'a@b.co' })).welcomeOffer,
    ).toBeNull();
  });
});
