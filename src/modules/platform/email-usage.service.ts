import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface EmailUsage {
  /** false si no hay RESEND_API_KEY o Resend no respondió. */
  available: boolean;
  sentToday: number;
  dailyLimit: number | null;
  remainingToday: number | null;
  sentThisMonth: number;
  monthlyLimit: number | null;
  remainingThisMonth: number | null;
  /** El conteo del mes se cortó (demasiadas páginas): es un mínimo. */
  monthIsPartial: boolean;
  /** Cuándo se reinicia el cupo diario (medianoche UTC, como cuenta Resend). */
  resetsAt: string;
  checkedAt: string;
}

/**
 * Fecha de Resend a epoch ms. Llega como "2026-11-20 14:27:44.996000+00"
 * (microsegundos y zona sin minutos), que Date.parse no acepta tal cual.
 */
export function parseResendDate(raw: string): number {
  const m =
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}(?::?\d{2})?)?$/.exec(
      raw.trim(),
    );
  if (!m) return Date.parse(raw);
  const ms = (m[3] ?? '0').padEnd(3, '0').slice(0, 3);
  let tz = m[4] ?? 'Z';
  if (tz !== 'Z') {
    const digits = tz.slice(1).replace(':', '');
    tz = `${tz[0]}${digits.slice(0, 2)}:${digits.slice(2, 4) || '00'}`;
  }
  return Date.parse(`${m[1]}T${m[2]}.${ms}${tz}`);
}

const PAGE = 100;
const MAX_PAGES = 40; // 4.000 correos: de sobra para el plan gratis (3.000/mes)
const CACHE_MS = 2 * 60_000;

/**
 * Uso del cupo de correos de Resend. Resend no expone el cupo restante en una
 * consulta (el header `x-resend-daily-quota` solo llega al enviar), así que se
 * cuentan los correos enviados hoy y este mes con `GET /emails`, que lista los
 * de toda la cuenta: el mismo alcance que el cupo. Los días y meses son UTC,
 * igual que el reinicio del cupo en Resend.
 *
 * Límites: RESEND_DAILY_LIMIT (100) y RESEND_MONTHLY_LIMIT (3000) del plan
 * gratis; en 0 significan "sin límite" (plan Pro: sin tope diario).
 */
@Injectable()
export class EmailUsageService {
  private readonly logger = new Logger(EmailUsageService.name);
  private cache: { value: EmailUsage; exp: number } | null = null;

  constructor(private readonly config: ConfigService) {}

  private limit(name: string, fallback: number): number | null {
    const raw = process.env[name];
    const n = raw === undefined || raw === '' ? fallback : Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  async getUsage(): Promise<EmailUsage> {
    if (this.cache && this.cache.exp > Date.now()) return this.cache.value;

    const now = new Date();
    const dayStart = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
    );
    const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
    const dailyLimit = this.limit('RESEND_DAILY_LIMIT', 100);
    const monthlyLimit = this.limit('RESEND_MONTHLY_LIMIT', 3000);
    const base = {
      dailyLimit,
      monthlyLimit,
      resetsAt: new Date(dayStart + 86_400_000).toISOString(),
      checkedAt: now.toISOString(),
    };

    const apiKey = this.config.get<string>('resend.apiKey');
    if (!apiKey) {
      return {
        ...base,
        available: false,
        sentToday: 0,
        remainingToday: dailyLimit,
        sentThisMonth: 0,
        remainingThisMonth: monthlyLimit,
        monthIsPartial: false,
      };
    }

    let sentToday = 0;
    let sentThisMonth = 0;
    let monthIsPartial = false;
    try {
      let after: string | null = null;
      for (let page = 0; ; page++) {
        if (page === MAX_PAGES) {
          monthIsPartial = true;
          break;
        }
        const url = new URL('https://api.resend.com/emails');
        url.searchParams.set('limit', String(PAGE));
        if (after) url.searchParams.set('after', after);
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!res.ok) throw new Error(`Resend respondió ${res.status}`);
        const body = (await res.json()) as {
          has_more?: boolean;
          data?: Array<{ id: string; created_at: string }>;
        };
        const rows = body.data ?? [];
        let reachedOlder = false;
        for (const e of rows) {
          const t = parseResendDate(e.created_at);
          if (Number.isNaN(t)) continue;
          if (t < monthStart) {
            reachedOlder = true;
            break;
          }
          sentThisMonth++;
          if (t >= dayStart) sentToday++;
        }
        if (reachedOlder || !body.has_more || rows.length === 0) break;
        after = rows[rows.length - 1].id;
      }
    } catch (err) {
      this.logger.warn(`No se pudo consultar el uso de Resend: ${String(err)}`);
      return {
        ...base,
        available: false,
        sentToday: 0,
        remainingToday: null,
        sentThisMonth: 0,
        remainingThisMonth: null,
        monthIsPartial: false,
      };
    }

    const value: EmailUsage = {
      ...base,
      available: true,
      sentToday,
      remainingToday:
        dailyLimit === null ? null : Math.max(0, dailyLimit - sentToday),
      sentThisMonth,
      remainingThisMonth:
        monthlyLimit === null
          ? null
          : Math.max(0, monthlyLimit - sentThisMonth),
      monthIsPartial,
    };
    this.cache = { value, exp: Date.now() + CACHE_MS };
    return value;
  }
}
