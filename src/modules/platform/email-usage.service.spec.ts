import type { ConfigService } from '@nestjs/config';
import { EmailUsageService, parseResendDate } from './email-usage.service';

const config = { get: () => 're_test' } as unknown as ConfigService;

function iso(d: Date) {
  return d.toISOString().replace('T', ' ').replace('Z', '+00');
}

describe('EmailUsageService', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    jest.useRealTimers();
  });

  it('cuenta los enviados hoy y este mes (UTC) y lo que queda del cupo', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-20T15:00:00Z') });
    const data = [
      { id: 'a', created_at: iso(new Date('2026-11-20T14:00:00Z')) },
      { id: 'b', created_at: iso(new Date('2026-11-20T01:00:00Z')) },
      { id: 'c', created_at: iso(new Date('2026-11-19T23:00:00Z')) },
      { id: 'd', created_at: iso(new Date('2026-10-31T23:00:00Z')) },
    ];
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ has_more: true, data }),
    }) as never;

    const u = await new EmailUsageService(config).getUsage();
    expect(u).toMatchObject({
      available: true,
      sentToday: 2,
      dailyLimit: 100,
      remainingToday: 98,
      sentThisMonth: 3,
      remainingThisMonth: 2997,
      resetsAt: '2026-11-21T00:00:00.000Z',
    });
    // Llegó a un correo del mes anterior: no pidió más páginas.
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('entiende el formato de fecha de Resend', () => {
    expect(parseResendDate('2026-11-20 14:27:44.996000+00')).toBe(
      Date.parse('2026-11-20T14:27:44.996Z'),
    );
    expect(parseResendDate('2026-11-20 09:27:44-05')).toBe(
      Date.parse('2026-11-20T14:27:44Z'),
    );
  });

  it('si Resend falla, lo marca como no disponible', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 500 }) as never;
    const u = await new EmailUsageService(config).getUsage();
    expect(u.available).toBe(false);
  });
});
