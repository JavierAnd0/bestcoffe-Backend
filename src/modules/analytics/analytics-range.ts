import { BadRequestException } from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, Matches } from 'class-validator';

/**
 * Rango de fechas de la analítica. Las fechas son días calendario de Colombia
 * (America/Bogota, UTC-5 fijo, sin horario de verano): "2026-11-01" empieza a
 * las 00:00 de Bogotá, que son las 05:00 UTC. Así los totales del día cuadran
 * con lo que el operador ve en su reloj y no con UTC.
 */
export const ANALYTICS_TZ = 'America/Bogota';
const TZ_OFFSET = '-05:00';
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DAYS = 366;

export type Granularity = 'day' | 'week' | 'month';

export class AnalyticsRangeQuery {
  @ApiPropertyOptional({ description: 'Desde (YYYY-MM-DD, hora de Colombia)' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string;

  @ApiPropertyOptional({ description: 'Hasta, inclusive (YYYY-MM-DD)' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string;

  @ApiPropertyOptional({ enum: ['day', 'week', 'month'] })
  @IsOptional()
  @IsIn(['day', 'week', 'month'])
  granularity?: Granularity;
}

export interface AnalyticsRange {
  from: string; // YYYY-MM-DD inclusive
  to: string; // YYYY-MM-DD inclusive
  granularity: Granularity;
  start: Date; // instante UTC de inicio (inclusive)
  end: Date; // instante UTC de fin (exclusivo)
  days: number;
  previous: { from: string; to: string; start: Date; end: Date };
}

/** Día calendario de Colombia para un instante. */
export function bogotaDate(d: Date): string {
  return new Date(d.getTime() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Inicio (00:00 Bogotá) de un día calendario, como instante UTC. */
export function startOfBogotaDay(date: string): Date {
  return new Date(`${date}T00:00:00${TZ_OFFSET}`);
}

function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

function isValidDate(date: string): boolean {
  const t = Date.parse(`${date}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().startsWith(date);
}

/**
 * Normaliza el rango pedido. Por defecto, los últimos 30 días hasta hoy. La
 * granularidad por defecto depende del largo: día hasta 62 días, semana hasta
 * 180, mes por encima. El periodo anterior tiene la misma cantidad de días y
 * termina justo antes de `from`, para las comparaciones Δ%.
 */
export function resolveRange(
  q: AnalyticsRangeQuery,
  now = new Date(),
): AnalyticsRange {
  const to = q.to ?? bogotaDate(now);
  const from = q.from ?? addDays(to, -29);
  if (!isValidDate(from) || !isValidDate(to)) {
    throw new BadRequestException('Fecha inválida');
  }
  if (from > to) {
    throw new BadRequestException('"from" debe ser anterior o igual a "to"');
  }
  const start = startOfBogotaDay(from);
  const end = startOfBogotaDay(addDays(to, 1));
  const days = Math.round((end.getTime() - start.getTime()) / DAY_MS);
  if (days > MAX_DAYS) {
    throw new BadRequestException(`El rango máximo es de ${MAX_DAYS} días`);
  }
  const granularity: Granularity =
    q.granularity ?? (days <= 62 ? 'day' : days <= 180 ? 'week' : 'month');

  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(days - 1));
  return {
    from,
    to,
    granularity,
    start,
    end,
    days,
    previous: {
      from: prevFrom,
      to: prevTo,
      start: startOfBogotaDay(prevFrom),
      end: start,
    },
  };
}

/** Clave de cubeta (YYYY-MM-DD) igual a la de `date_trunc` en Postgres. */
export function bucketKey(date: string, g: Granularity): string {
  if (g === 'day') return date;
  if (g === 'month') return `${date.slice(0, 7)}-01`;
  // date_trunc('week') → lunes
  const d = new Date(`${date}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // lunes = 0
  return addDays(date, -dow);
}

/** Todas las cubetas del rango, en orden, para rellenar huecos con ceros. */
export function rangeBuckets(range: AnalyticsRange): string[] {
  const keys: string[] = [];
  let cursor = range.from;
  while (cursor <= range.to) {
    const k = bucketKey(cursor, range.granularity);
    if (keys[keys.length - 1] !== k) keys.push(k);
    cursor = addDays(cursor, 1);
  }
  return keys;
}

/** Δ% redondeado; null si no hay base para comparar. */
export function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export { addDays };
