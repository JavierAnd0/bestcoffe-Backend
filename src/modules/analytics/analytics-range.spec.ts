import { BadRequestException } from '@nestjs/common';
import {
  bogotaDate,
  bucketKey,
  pctChange,
  rangeBuckets,
  resolveRange,
} from './analytics-range';
import { monthlyRecurringCents } from './platform-analytics.service';

describe('Rango de analítica', () => {
  // 2026-11-17 03:00 UTC = 2026-11-16 22:00 en Bogotá
  const now = new Date('2026-11-17T03:00:00Z');

  it('usa el día de Colombia, no el de UTC', () => {
    expect(bogotaDate(now)).toBe('2026-11-16');
  });

  it('por defecto: últimos 30 días hasta hoy, por día', () => {
    const r = resolveRange({}, now);
    expect(r.from).toBe('2026-10-18');
    expect(r.to).toBe('2026-11-16');
    expect(r.days).toBe(30);
    expect(r.granularity).toBe('day');
    // 00:00 Bogotá = 05:00 UTC; el fin es exclusivo (día siguiente)
    expect(r.start.toISOString()).toBe('2026-10-18T05:00:00.000Z');
    expect(r.end.toISOString()).toBe('2026-11-17T05:00:00.000Z');
  });

  it('el periodo anterior tiene el mismo largo y termina antes de from', () => {
    const r = resolveRange({ from: '2026-11-01', to: '2026-11-10' }, now);
    expect(r.previous).toMatchObject({ from: '2026-10-22', to: '2026-10-31' });
    expect(r.previous.end).toEqual(r.start);
  });

  it('elige la granularidad según el largo', () => {
    expect(
      resolveRange({ from: '2026-01-01', to: '2026-04-30' }, now).granularity,
    ).toBe('week');
    expect(
      resolveRange({ from: '2026-01-01', to: '2026-11-16' }, now).granularity,
    ).toBe('month');
  });

  it('rechaza rangos invertidos, fechas imposibles y más de 366 días', () => {
    expect(() =>
      resolveRange({ from: '2026-11-10', to: '2026-11-01' }, now),
    ).toThrow(BadRequestException);
    expect(() => resolveRange({ from: '2026-02-30' }, now)).toThrow(
      BadRequestException,
    );
    expect(() =>
      resolveRange({ from: '2024-01-01', to: '2026-01-01' }, now),
    ).toThrow(BadRequestException);
  });

  it('las cubetas cuadran con date_trunc (semanas desde el lunes)', () => {
    expect(bucketKey('2026-11-16', 'week')).toBe('2026-11-16'); // lunes
    expect(bucketKey('2026-11-22', 'week')).toBe('2026-11-16'); // domingo
    expect(bucketKey('2026-11-22', 'month')).toBe('2026-11-01');
    const r = resolveRange(
      { from: '2026-11-01', to: '2026-11-30', granularity: 'week' },
      now,
    );
    expect(rangeBuckets(r)).toEqual([
      '2026-10-26',
      '2026-11-02',
      '2026-11-09',
      '2026-11-16',
      '2026-11-23',
      '2026-11-30',
    ]);
  });

  it('Δ% sin base devuelve null', () => {
    expect(pctChange(150, 100)).toBe(50);
    expect(pctChange(0, 0)).toBe(0);
    expect(pctChange(10, 0)).toBeNull();
  });
});

describe('MRR por tienda', () => {
  const base = {
    billingType: 'SUBSCRIPTION' as const,
    billingStatus: 'ACTIVE' as const,
    billingCycle: 'MONTHLY' as const,
    hasMaintenance: false,
    billingAmountCents: 30_000_00,
  };

  it('normaliza el monto por la frecuencia del cobro', () => {
    expect(monthlyRecurringCents(base)).toBe(30_000_00);
    expect(monthlyRecurringCents({ ...base, billingCycle: 'QUARTERLY' })).toBe(
      10_000_00,
    );
    expect(monthlyRecurringCents({ ...base, billingCycle: 'ANNUAL' })).toBe(
      2_500_00,
    );
  });

  it('pago único sin mantenimiento no es recurrente', () => {
    expect(monthlyRecurringCents({ ...base, billingType: 'ONE_TIME' })).toBe(0);
    expect(
      monthlyRecurringCents({
        ...base,
        billingType: 'ONE_TIME',
        hasMaintenance: true,
      }),
    ).toBe(30_000_00);
  });

  it('suspendidas no suman; PAST_DUE sí (sigue siendo cliente)', () => {
    expect(monthlyRecurringCents({ ...base, billingStatus: 'CANCELLED' })).toBe(
      0,
    );
    expect(monthlyRecurringCents({ ...base, billingStatus: 'PAST_DUE' })).toBe(
      30_000_00,
    );
  });

  it('recurrente sin monto cargado devuelve null', () => {
    expect(
      monthlyRecurringCents({ ...base, billingAmountCents: null }),
    ).toBeNull();
  });
});
