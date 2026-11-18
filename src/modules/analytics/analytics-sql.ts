import { Prisma } from '@prisma/client';
import type { Granularity } from './analytics-range';

/**
 * Expresión SQL de la cubeta (YYYY-MM-DD) de una columna timestamp guardada en
 * UTC, truncada en hora de Colombia. `col` es un identificador fijo del código,
 * nunca entrada del usuario; la granularidad viaja como parámetro.
 */
export function bucketSql(col: string, g: Granularity): Prisma.Sql {
  return Prisma.sql`to_char(date_trunc(${g}, (${Prisma.raw(col)} AT TIME ZONE 'UTC') AT TIME ZONE 'America/Bogota'), 'YYYY-MM-DD')`;
}

/** Postgres devuelve SUM/COUNT como bigint/numeric → number seguro. */
export function num(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return Number(v);
  // Prisma.Decimal y similares exponen toString() con el valor numérico.
  return Number((v as { toString(): string }).toString());
}
