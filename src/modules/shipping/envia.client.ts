import { BadGatewayException, Logger } from '@nestjs/common';

/**
 * Cliente HTTP mínimo de Envia.com (https://docs.envia.com).
 *
 * - API de envíos (cotizar, generar, cancelar, rastrear, ubicar):
 *   `api-test.envia.com` / `api.envia.com`.
 * - API de consultas (transportadoras, departamentos, webhooks):
 *   `queries.test.envia.com` / `queries.envia.com`.
 *
 * Cada tienda usa su propio token (Bearer). El cliente no guarda estado: se
 * crea por llamada con el token y el entorno de la tienda.
 */

const HTTP_TIMEOUT_MS = 20_000;

export type EnviaAddress = {
  name: string;
  phone: string;
  street: string;
  number?: string;
  district?: string;
  city: string; // código DANE de 8 dígitos
  state: string; // código de departamento de Envia (2 letras)
  country: 'CO';
  postalCode: string;
  email?: string;
  reference?: string;
  company?: string;
  identificationNumber?: string;
};

export type EnviaPackage = {
  type: 'box';
  content: string;
  amount: number;
  declaredValue: number;
  lengthUnit: 'CM';
  weightUnit: 'KG';
  weight: number;
  dimensions: { length: number; width: number; height: number };
};

export type EnviaRate = {
  carrier: string;
  service: string;
  serviceDescription: string;
  deliveryEstimate: string | null;
  totalPrice: number;
  currency: string;
};

export type EnviaLabel = {
  carrier: string;
  service: string;
  shipmentId: string | null;
  trackingNumber: string;
  trackUrl: string | null;
  label: string | null;
  totalPrice: number;
  currency: string;
};

export type EnviaTracking = {
  trackingNumber: string;
  status: unknown;
  description: string | null;
  location: string | null;
  eventAt: Date | null;
  trackUrl: string | null;
};

export type EnviaState = { name: string; code: string };

type Json = Record<string, unknown>;

export class EnviaApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export class EnviaClient {
  private readonly logger = new Logger(EnviaClient.name);
  private readonly shipBase: string;
  private readonly queriesBase: string;

  constructor(
    private readonly token: string,
    test: boolean,
    private readonly fetchImpl: typeof fetch = fetch,
    overrides: { shipBase?: string; queriesBase?: string } = {},
  ) {
    this.shipBase =
      overrides.shipBase ||
      (test ? 'https://api-test.envia.com' : 'https://api.envia.com');
    this.queriesBase =
      overrides.queriesBase ||
      (test ? 'https://queries.test.envia.com' : 'https://queries.envia.com');
  }

  /** Transportadoras activas de la cuenta en Colombia (slug para la API). */
  async carriers(): Promise<string[]> {
    const res = await this.request<Json>(
      'GET',
      `${this.queriesBase}/carrier?country_code=CO`,
    );
    const rows = Array.isArray(res.data) ? (res.data as Json[]) : [];
    const names = rows
      .filter(
        (r) => r.active === undefined || r.active === true || r.active === 1,
      )
      .map((r) => str(r.name).trim())
      .filter(Boolean);
    return [...new Set(names)];
  }

  /** Departamentos de Colombia con su código de Envia. */
  async states(): Promise<EnviaState[]> {
    const res = await this.request<Json>(
      'GET',
      `${this.queriesBase}/state?country_code=CO`,
    );
    const rows = Array.isArray(res.data) ? (res.data as Json[]) : [];
    return rows
      .map((r) => ({
        name: str(r.name),
        code: str(r.code_2_digits) || str(r.code),
      }))
      .filter((s) => s.name && s.code);
  }

  /**
   * Código DANE (8 dígitos) de una ciudad. Envia lo exige en `city` para las
   * transportadoras colombianas. Devuelve null si no la reconoce.
   */
  async locate(
    city: string,
    state: string,
  ): Promise<{ city: string; name: string; state: string } | null> {
    try {
      const res = await this.request<Json>('POST', `${this.shipBase}/locate`, {
        city,
        state,
        country: 'CO',
      });
      if (typeof res.city !== 'string' || !/^\d{8}$/.test(res.city))
        return null;
      return {
        city: res.city,
        name: str(res.name, city),
        state: str(res.state, state),
      };
    } catch (err) {
      if (err instanceof EnviaApiError && err.status < 500) return null;
      throw err;
    }
  }

  /** Cotiza con una transportadora. Devuelve un renglón por servicio. */
  async rate(input: {
    origin: EnviaAddress;
    destination: EnviaAddress;
    packages: EnviaPackage[];
    carrier: string;
  }): Promise<EnviaRate[]> {
    const res = await this.request<Json>(
      'POST',
      `${this.shipBase}/ship/rate/`,
      {
        origin: input.origin,
        destination: input.destination,
        packages: input.packages,
        shipment: { type: 1, carrier: input.carrier },
        settings: { currency: 'COP' },
      },
    );
    const rows = Array.isArray(res.data) ? (res.data as Json[]) : [];
    return rows
      .map((r) => ({
        carrier: str(r.carrier, input.carrier),
        service: str(r.service),
        serviceDescription: str(r.serviceDescription) || str(r.service),
        deliveryEstimate:
          typeof r.deliveryEstimate === 'string' ? r.deliveryEstimate : null,
        totalPrice: Number(r.totalPrice),
        currency: str(r.currency, 'COP'),
      }))
      .filter((r) => r.service && Number.isFinite(r.totalPrice));
  }

  /** Genera la guía (se cobra del saldo de la cuenta de Envia). */
  async generate(input: {
    origin: EnviaAddress;
    destination: EnviaAddress;
    packages: EnviaPackage[];
    carrier: string;
    service: string;
    orderReference: string;
    printSize: string;
  }): Promise<EnviaLabel> {
    const res = await this.request<Json>(
      'POST',
      `${this.shipBase}/ship/generate/`,
      {
        origin: input.origin,
        destination: input.destination,
        packages: input.packages,
        shipment: {
          type: 1,
          carrier: input.carrier,
          service: input.service,
          orderReference: input.orderReference,
        },
        settings: {
          printFormat: 'PDF',
          printSize: input.printSize,
          currency: 'COP',
        },
      },
    );
    const row = (Array.isArray(res.data) ? res.data[0] : res.data) as
      Json | undefined;
    const trackingNumber = row?.trackingNumber;
    if (!row || typeof trackingNumber !== 'string' || !trackingNumber) {
      throw new BadGatewayException('Envia no devolvió el número de guía');
    }
    return {
      carrier: str(row.carrier, input.carrier),
      service: str(row.service, input.service),
      shipmentId: str(row.shipmentId) || null,
      trackingNumber,
      trackUrl: typeof row.trackUrl === 'string' ? row.trackUrl : null,
      label: typeof row.label === 'string' ? row.label : null,
      totalPrice: Number(row.totalPrice ?? 0),
      currency: str(row.currency, 'COP'),
    };
  }

  /** Anula una guía que la transportadora aún no ha recogido. */
  async cancel(carrier: string, trackingNumber: string): Promise<void> {
    await this.request('POST', `${this.shipBase}/ship/cancel/`, {
      carrier,
      trackingNumber,
    });
  }

  /**
   * Estado actual de varias guías (Envia acepta lotes). La forma exacta de la
   * respuesta no está documentada, así que se leen los nombres de campo más
   * probables y se ignora lo que no se entienda.
   */
  async track(trackingNumbers: string[]): Promise<EnviaTracking[]> {
    if (trackingNumbers.length === 0) return [];
    const res = await this.request<Json>(
      'POST',
      `${this.shipBase}/ship/generaltrack/`,
      { trackingNumbers },
    );
    const rows = Array.isArray(res.data) ? (res.data as Json[]) : [];
    return rows
      .map((r) => parseTrackingRow(r))
      .filter((r): r is EnviaTracking => r !== null);
  }

  /** Registra el webhook de seguimiento (tipo 3, `tracking.simple`). */
  async createTrackingWebhook(url: string): Promise<number | null> {
    const res = await this.request<Json>(
      'POST',
      `${this.queriesBase}/webhooks`,
      {
        type_id: 3,
        url,
        active: 1,
      },
    );
    const id = (res.data as Json | undefined)?.id;
    return typeof id === 'number' ? id : id ? Number(id) || null : null;
  }

  /** Desactiva un webhook (Envia no documenta borrarlo). */
  async deactivateWebhook(id: number): Promise<void> {
    await this.request('PUT', `${this.queriesBase}/webhooks/${id}`, {
      active: 0,
    });
  }

  private async request<T = unknown>(
    method: 'GET' | 'POST' | 'PUT',
    url: string,
    body?: unknown,
  ): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
    } catch (err) {
      this.logger.warn(`Envia ${method} ${url} falló: ${String(err)}`);
      throw new EnviaApiError('No se pudo contactar a Envia', 503);
    }

    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      // Algunos errores de Envia vienen en texto plano ("Authentication error.").
    }

    const meta = (parsed as Json | null)?.meta;
    if (!res.ok || meta === 'error') {
      const message = extractError(parsed) ?? `Envia respondió ${res.status}`;
      throw new EnviaApiError(message, res.ok ? 422 : res.status);
    }
    return parsed as T;
  }
}

/** Texto de un campo JSON que puede venir como texto o número. */
function str(v: unknown, fallback = ''): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return fallback;
}

function extractError(body: unknown): string | null {
  if (typeof body === 'string') return body.trim() || null;
  if (!body || typeof body !== 'object') return null;
  const b = body as Json;
  const error = b.error as Json | string | undefined;
  if (typeof error === 'string') return (b.message as string) ?? error;
  if (error && typeof error === 'object') {
    return str(error.message) || str(error.description) || null;
  }
  return typeof b.message === 'string' ? b.message : null;
}

function parseTrackingRow(r: Json): EnviaTracking | null {
  const trackingNumber = r.trackingNumber ?? r.tracking_number;
  if (typeof trackingNumber !== 'string' || !trackingNumber) return null;
  const events = (r.eventHistory ?? r.events ?? r.history) as
    Json[] | undefined;
  const last =
    Array.isArray(events) && events.length > 0
      ? events[events.length - 1]
      : undefined;
  const rawDate = r.updatedAt ?? r.updated_at ?? last?.date ?? last?.created_at;
  const eventAt = typeof rawDate === 'string' ? new Date(rawDate) : null;
  const description =
    r.statusDescription ??
    r.status_description ??
    last?.description ??
    last?.event;
  const location = r.location ?? last?.location;
  return {
    trackingNumber,
    status: r.status ?? r.statusId ?? r.status_id,
    description: typeof description === 'string' ? description : null,
    location: typeof location === 'string' ? location : null,
    eventAt: eventAt && !Number.isNaN(eventAt.getTime()) ? eventAt : null,
    trackUrl:
      typeof r.trackUrl === 'string'
        ? r.trackUrl
        : typeof r.track_url === 'string'
          ? r.track_url
          : null,
  };
}
