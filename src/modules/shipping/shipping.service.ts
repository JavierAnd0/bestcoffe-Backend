import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  OrderStatus,
  Prisma,
  ShipmentStatus,
  type Shipment,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import {
  EnviaApiError,
  type EnviaAddress,
  type EnviaPackage,
  type EnviaRate,
  type EnviaTracking,
} from './envia.client';
import {
  EnviaAccountService,
  type EnviaAccount,
} from './envia-account.service';
import {
  mapEnviaStatus,
  normalizeEnviaStatus,
  OPEN_SHIPMENT_STATUSES,
  packageWeightKg,
  verifyEnviaSignature,
} from './envia-status';
import type { CreateLabelDto, ShipmentOverridesDto } from './dto/shipping.dto';

type ShippingAddress = {
  recipientName?: string;
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  phone?: string;
};

/** Pedido con lo necesario para armar la guía. */
type OrderForLabel = Prisma.OrderGetPayload<{
  include: {
    items: { select: { sizeGrams: true; quantity: true } };
    customer: { select: { name: true; email: true; phone: true } };
    shipments: true;
  };
}>;

/** Un aviso de seguimiento ya normalizado (de webhook o de consulta). */
export type TrackingUpdate = {
  status: unknown;
  description?: string | null;
  location?: string | null;
  eventAt?: Date | null;
  trackUrl?: string | null;
};

const SHIPPABLE_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.RECEIVED,
  OrderStatus.PREPARING,
];
/** El job deja de consultar una guía que lleva más de esto sin cerrarse. */
const MAX_TRACKING_AGE_MS = 60 * 24 * 60 * 60 * 1000;
/** Y no la vuelve a consultar antes de esto (el webhook suele llegar antes). */
const MIN_RECHECK_MS = 25 * 60 * 1000;
const TRACK_BATCH = 25;

/**
 * Guías de envío con Envia.com: cotizar y generar desde el panel, y mover el
 * estado del pedido con lo que reporta la transportadora (webhook firmado o,
 * de respaldo, consulta periódica con Inngest).
 *
 * Reglas del estado del pedido:
 * - Generar la guía pasa el pedido de RECEIVED a PREPARING.
 * - En camino → SHIPPED (correo al cliente). Entregada → DELIVERED.
 * - Nunca retrocede, nunca toca un pedido CANCELLED y solo la guía activa
 *   del pedido (la que está en `Order.trackingNumber`) lo mueve.
 */
@Injectable()
export class ShippingService {
  private readonly logger = new Logger(ShippingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: EnviaAccountService,
    private readonly mail: MailService,
  ) {}

  // ─── Panel: cotizar, generar y anular ───────────────────────────────────────

  async listShipments(tenantId: string, orderId: string) {
    await this.ensureOrder(tenantId, orderId);
    return this.prisma.shipment.findMany({
      where: { tenantId, orderId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Cotiza con todas las transportadoras activas de la cuenta, de menor a mayor precio. */
  async quote(
    tenantId: string,
    orderId: string,
    overrides: ShipmentOverridesDto,
  ) {
    const order = await this.loadShippableOrder(tenantId, orderId);
    const account = await this.accounts.requireAccount(tenantId);
    const { destination, packages } = await this.buildShipment(
      account,
      order,
      overrides,
    );

    let carriers: string[];
    try {
      carriers = await account.client.carriers();
    } catch (err) {
      throw this.toHttpError(
        err,
        'No se pudo consultar las transportadoras de Envia',
      );
    }
    if (carriers.length === 0) {
      throw new BadRequestException(
        'Tu cuenta de Envia no tiene transportadoras activas en Colombia',
      );
    }

    const results = await Promise.allSettled(
      carriers.map((carrier) =>
        account.client.rate({
          origin: this.originAddress(account),
          destination,
          packages,
          carrier,
        }),
      ),
    );
    const rates: EnviaRate[] = results
      .flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
      .sort((a, b) => a.totalPrice - b.totalPrice);

    if (rates.length === 0) {
      const firstError = results.find((r) => r.status === 'rejected');
      const reason =
        firstError?.status === 'rejected'
          ? (firstError.reason as Error).message
          : null;
      throw new BadRequestException(
        `Ninguna transportadora cotizó este envío${reason ? `: ${reason}` : ''}`,
      );
    }

    return {
      rates: rates.map((r) => ({
        carrier: r.carrier,
        service: r.service,
        serviceDescription: r.serviceDescription,
        deliveryEstimate: r.deliveryEstimate,
        totalCents: Math.round(r.totalPrice * 100),
        currency: r.currency,
      })),
      package: {
        weightKg: packages[0].weight,
        lengthCm: packages[0].dimensions.length,
        widthCm: packages[0].dimensions.width,
        heightCm: packages[0].dimensions.height,
      },
      destination: { cityCode: destination.city, stateCode: destination.state },
      test: account.test,
    };
  }

  /** Genera la guía con la transportadora y el servicio elegidos. */
  async createLabel(tenantId: string, orderId: string, dto: CreateLabelDto) {
    const order = await this.loadShippableOrder(tenantId, orderId);
    const account = await this.accounts.requireAccount(tenantId);
    const { destination, packages } = await this.buildShipment(
      account,
      order,
      dto,
    );

    let label;
    try {
      label = await account.client.generate({
        origin: this.originAddress(account),
        destination,
        packages,
        carrier: dto.carrier,
        service: dto.service,
        orderReference: order.id,
        printSize: dto.printSize ?? 'PAPER_4X6',
      });
    } catch (err) {
      throw this.toHttpError(err, 'Envia no pudo generar la guía');
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Doble clic o dos operadores a la vez: si otra guía ganó mientras
        // Envia respondía, esta sobra (se anula abajo).
        const active = await tx.shipment.findFirst({
          where: { orderId, status: { not: ShipmentStatus.CANCELLED } },
          select: { id: true },
        });
        if (active)
          throw new ConflictException('El pedido ya tiene una guía activa');

        const shipment = await tx.shipment.create({
          data: {
            tenantId,
            orderId,
            provider: 'ENVIA',
            carrier: label.carrier,
            service: label.service,
            trackingNumber: label.trackingNumber,
            providerShipmentId: label.shipmentId,
            labelUrl: label.label,
            trackingUrl: label.trackUrl,
            costCents: Math.round(label.totalPrice * 100),
            currency: label.currency,
            status: ShipmentStatus.LABEL_CREATED,
            providerStatus: 'created',
            lastEventAt: new Date(),
          },
        });
        await tx.order.update({
          where: { id: orderId },
          data: {
            shippingCarrier: label.carrier,
            trackingNumber: label.trackingNumber,
            ...(label.trackUrl && { trackingUrl: label.trackUrl }),
            ...(order.status === OrderStatus.RECEIVED && {
              status: OrderStatus.PREPARING,
            }),
          },
        });
        return shipment;
      });
    } catch (err) {
      if (err instanceof ConflictException) {
        await account.client
          .cancel(label.carrier, label.trackingNumber)
          .catch((e: unknown) =>
            this.logger.error(
              `Guía duplicada ${label.trackingNumber} del pedido ${orderId} no se pudo anular: ${String(e)}`,
            ),
          );
      }
      throw err;
    }
  }

  /** Anula la guía activa si la transportadora aún no la ha recogido. */
  async cancelLabel(tenantId: string, orderId: string) {
    await this.ensureOrder(tenantId, orderId);
    const shipment = await this.prisma.shipment.findFirst({
      where: { tenantId, orderId, status: { not: ShipmentStatus.CANCELLED } },
      orderBy: { createdAt: 'desc' },
    });
    if (!shipment)
      throw new NotFoundException('El pedido no tiene una guía activa');
    if (shipment.status !== ShipmentStatus.LABEL_CREATED) {
      throw new BadRequestException(
        'La transportadora ya recogió el paquete: la guía no se puede anular',
      );
    }
    const account = await this.accounts.requireAccount(tenantId);
    try {
      await account.client.cancel(shipment.carrier, shipment.trackingNumber);
    } catch (err) {
      throw this.toHttpError(err, 'Envia no pudo anular la guía');
    }
    return this.markCancelled(shipment);
  }

  // ─── Seguimiento: webhook y consulta periódica ──────────────────────────────

  /**
   * Webhook de Envia (`tracking.simple`). Se verifica la firma con el secreto
   * de la tienda y, con la guía identificada, se consulta su estado a Envia
   * (lo que diga la API manda sobre el aviso). Idempotente por X-Webhook-Id.
   */
  async handleWebhook(
    tenantId: string,
    headers: Record<string, string | string[] | undefined>,
    rawBody: string,
  ) {
    const header = (name: string) => {
      const v = headers[name.toLowerCase()];
      return Array.isArray(v) ? v[0] : v;
    };

    const secret = await this.accounts.webhookSecret(tenantId);
    if (!secret) throw new NotFoundException('Tienda sin Envia conectado');

    const valid = verifyEnviaSignature({
      secret,
      signature: header('x-webhook-signature'),
      timestamp: header('x-webhook-timestamp'),
      event: header('x-webhook-event'),
      rawBody,
    });
    if (!valid) {
      this.logger.warn(
        `Webhook de Envia con firma inválida para la tienda ${tenantId}`,
      );
      throw new UnauthorizedException('Firma inválida');
    }

    const eventId = header('x-webhook-id');
    if (eventId) {
      const seen = await this.prisma.shippingEvent.findUnique({
        where: { id: eventId },
      });
      if (seen) return { ok: true, duplicate: true };
    }

    let payload: { type?: string; data?: Record<string, unknown> };
    try {
      payload = JSON.parse(rawBody) as typeof payload;
    } catch {
      throw new BadRequestException('Cuerpo inválido');
    }
    const data = payload.data ?? {};
    const trackingNumber = data.tracking_number ?? data.trackingNumber;

    let applied = false;
    if (typeof trackingNumber === 'string' && trackingNumber) {
      const shipment = await this.prisma.shipment.findFirst({
        where: { tenantId, provider: 'ENVIA', trackingNumber },
      });
      if (shipment) {
        const fromApi = await this.fetchTracking(tenantId, [trackingNumber]);
        const update: TrackingUpdate = fromApi.get(trackingNumber) ?? {
          status: data.status,
          description:
            typeof data.status_description === 'string'
              ? data.status_description
              : null,
          location: typeof data.location === 'string' ? data.location : null,
          eventAt: new Date(),
        };
        await this.applyTracking(shipment, update);
        applied = true;
      }
    }

    if (eventId) {
      await this.prisma.shippingEvent
        .create({
          data: {
            id: eventId,
            type: payload.type ?? header('x-webhook-event') ?? 'unknown',
          },
        })
        .catch((err: unknown) => {
          if (!(
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === 'P2002'
          ))
            throw err;
        });
    }
    return { ok: true, applied };
  }

  /**
   * Respaldo del webhook: consulta en lotes las guías abiertas que llevan un
   * rato sin noticias. Lo corre el job de Inngest.
   */
  async refreshOpenShipments(now = new Date()) {
    const shipments = await this.prisma.shipment.findMany({
      where: {
        provider: 'ENVIA',
        status: { in: OPEN_SHIPMENT_STATUSES },
        createdAt: { gte: new Date(now.getTime() - MAX_TRACKING_AGE_MS) },
        OR: [
          { lastCheckedAt: null },
          { lastCheckedAt: { lt: new Date(now.getTime() - MIN_RECHECK_MS) } },
        ],
      },
      orderBy: { lastCheckedAt: { sort: 'asc', nulls: 'first' } },
      take: 500,
    });

    const byTenant = new Map<string, Shipment[]>();
    for (const s of shipments)
      byTenant.set(s.tenantId, [...(byTenant.get(s.tenantId) ?? []), s]);

    let checked = 0;
    let changed = 0;
    for (const [tenantId, list] of byTenant) {
      for (let i = 0; i < list.length; i += TRACK_BATCH) {
        const batch = list.slice(i, i + TRACK_BATCH);
        const results = await this.fetchTracking(
          tenantId,
          batch.map((s) => s.trackingNumber),
        );
        for (const shipment of batch) {
          checked++;
          const update = results.get(shipment.trackingNumber);
          if (update) {
            if (await this.applyTracking(shipment, update)) changed++;
          } else {
            await this.prisma.shipment.update({
              where: { id: shipment.id },
              data: { lastCheckedAt: now },
            });
          }
        }
      }
    }
    return { checked, changed };
  }

  /**
   * Aplica un estado de la transportadora a la guía y, si es la guía activa,
   * al pedido. Devuelve true si cambió el estado de la guía.
   */
  async applyTracking(
    shipment: Shipment,
    update: TrackingUpdate,
  ): Promise<boolean> {
    const next = mapEnviaStatus(update.status);
    const now = new Date();
    const detail =
      [update.description, update.location].filter(Boolean).join(' · ') || null;
    const terminal =
      shipment.status === ShipmentStatus.DELIVERED ||
      shipment.status === ShipmentStatus.CANCELLED;

    if (next === null || terminal || next === shipment.status) {
      await this.prisma.shipment.update({
        where: { id: shipment.id },
        data: {
          lastCheckedAt: now,
          ...(!terminal && detail && { statusDetail: detail }),
          ...(!terminal &&
            update.trackUrl &&
            !shipment.trackingUrl && { trackingUrl: update.trackUrl }),
        },
      });
      return false;
    }

    if (next === ShipmentStatus.CANCELLED) {
      await this.markCancelled(shipment);
      return true;
    }

    // Una guía no vuelve a "creada" desde "en camino" (eventos fuera de orden).
    if (
      next === ShipmentStatus.LABEL_CREATED &&
      shipment.status === ShipmentStatus.IN_TRANSIT
    ) {
      await this.prisma.shipment.update({
        where: { id: shipment.id },
        data: { lastCheckedAt: now },
      });
      return false;
    }

    await this.prisma.shipment.update({
      where: { id: shipment.id },
      data: {
        status: next,
        providerStatus: normalizeEnviaStatus(update.status) || null,
        statusDetail: detail,
        lastEventAt: update.eventAt ?? now,
        lastCheckedAt: now,
        ...(next === ShipmentStatus.DELIVERED && {
          deliveredAt: update.eventAt ?? now,
        }),
        ...(update.trackUrl &&
          !shipment.trackingUrl && { trackingUrl: update.trackUrl }),
      },
    });

    if (next === ShipmentStatus.IN_TRANSIT) {
      await this.advanceOrder(shipment, OrderStatus.SHIPPED);
    } else if (next === ShipmentStatus.DELIVERED) {
      await this.advanceOrder(shipment, OrderStatus.DELIVERED);
    }
    return true;
  }

  // ─── Internos ───────────────────────────────────────────────────────────────

  /**
   * Mueve el pedido hacia adelante si la guía es la activa. El `updateMany`
   * con el estado de origen en el filtro evita carreras entre el webhook y el
   * job (solo uno gana y solo ese manda el correo).
   */
  private async advanceOrder(shipment: Shipment, target: OrderStatus) {
    const from: OrderStatus[] =
      target === OrderStatus.SHIPPED
        ? [OrderStatus.RECEIVED, OrderStatus.PREPARING]
        : [OrderStatus.RECEIVED, OrderStatus.PREPARING, OrderStatus.SHIPPED];

    const before = await this.prisma.order.findFirst({
      where: { id: shipment.orderId, trackingNumber: shipment.trackingNumber },
      select: { status: true },
    });
    if (!before || !from.includes(before.status)) return;

    const { count } = await this.prisma.order.updateMany({
      where: {
        id: shipment.orderId,
        trackingNumber: shipment.trackingNumber,
        status: { in: from },
      },
      data: { status: target },
    });
    if (count === 0) return;

    // Si pasó directo a entregado sin pasar por "en camino", el cliente nunca
    // recibió el aviso de despacho: tampoco se manda ya, no aporta nada.
    if (target === OrderStatus.SHIPPED)
      await this.notifyShipped(shipment.orderId);
  }

  private async notifyShipped(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        tenantId: true,
        trackingUrl: true,
        customer: { select: { email: true, name: true } },
      },
    });
    if (!order?.customer?.email) return;
    void this.mail
      .sendOrderShipped({
        to: order.customer.email,
        customerName: order.customer.name,
        orderId: order.id,
        tenantId: order.tenantId,
        trackingUrl: order.trackingUrl,
      })
      .catch((err: unknown) =>
        this.logger.warn(
          `No se pudo enviar el correo de despacho del pedido ${order.id}: ${String(err)}`,
        ),
      );
  }

  private async markCancelled(shipment: Shipment) {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.shipment.update({
        where: { id: shipment.id },
        data: {
          status: ShipmentStatus.CANCELLED,
          providerStatus: 'canceled',
          cancelledAt: new Date(),
          lastCheckedAt: new Date(),
        },
      });
      // El pedido deja de apuntar a esta guía (queda listo para otra).
      await tx.order.updateMany({
        where: {
          id: shipment.orderId,
          trackingNumber: shipment.trackingNumber,
        },
        data: {
          trackingNumber: null,
          shippingCarrier: null,
          trackingUrl: null,
        },
      });
      return updated;
    });
  }

  /** Estado de varias guías de una tienda. Un fallo de Envia no rompe el lote. */
  private async fetchTracking(
    tenantId: string,
    trackingNumbers: string[],
  ): Promise<Map<string, EnviaTracking>> {
    const out = new Map<string, EnviaTracking>();
    const account = await this.accounts.findAccount(tenantId);
    if (!account) return out;
    try {
      for (const row of await account.client.track(trackingNumbers)) {
        out.set(row.trackingNumber, row);
      }
    } catch (err) {
      this.logger.warn(
        `No se pudo consultar el seguimiento en Envia (${tenantId}): ${String(err)}`,
      );
    }
    return out;
  }

  private async ensureOrder(tenantId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId },
      select: { id: true },
    });
    if (!order) throw new NotFoundException('Pedido no encontrado');
  }

  private async loadShippableOrder(
    tenantId: string,
    orderId: string,
  ): Promise<OrderForLabel> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId },
      include: {
        items: { select: { sizeGrams: true, quantity: true } },
        customer: { select: { name: true, email: true, phone: true } },
        shipments: { where: { status: { not: ShipmentStatus.CANCELLED } } },
      },
    });
    if (!order) throw new NotFoundException('Pedido no encontrado');
    if (order.paymentStatus !== 'PAID') {
      throw new BadRequestException('Solo se generan guías de pedidos pagados');
    }
    if (!SHIPPABLE_ORDER_STATUSES.includes(order.status)) {
      throw new BadRequestException(
        'El pedido ya fue despachado, entregado o cancelado',
      );
    }
    if (order.shipments.length > 0) {
      throw new ConflictException(
        'El pedido ya tiene una guía activa. Anúlala para generar otra.',
      );
    }
    return order;
  }

  private async buildShipment(
    account: EnviaAccount,
    order: OrderForLabel,
    overrides: ShipmentOverridesDto,
  ): Promise<{ destination: EnviaAddress; packages: EnviaPackage[] }> {
    const addr = (order.shippingAddress ?? {}) as ShippingAddress;
    const phone = (addr.phone ?? order.customer.phone ?? '').replace(
      /[^\d]/g,
      '',
    );
    if (!addr.line1 || !addr.city) {
      throw new BadRequestException(
        'El pedido no tiene dirección de envío completa',
      );
    }
    if (phone.length < 7) {
      throw new BadRequestException(
        'El pedido no tiene un teléfono de contacto: agrégalo en la dirección de envío',
      );
    }

    let cityCode = overrides.destinationCityCode;
    let stateCode = overrides.destinationStateCode;
    if (!cityCode || !stateCode) {
      const place = await this.accounts.resolvePlace(
        account.client,
        account.test,
        addr.city,
        stateCode ?? addr.state,
      );
      if (!place && !cityCode) {
        throw new BadRequestException(
          `Envia no reconoce "${addr.city}${addr.state ? `, ${addr.state}` : ''}". Escribe el código DANE y el departamento del destino.`,
        );
      }
      cityCode = cityCode ?? place!.cityCode;
      stateCode = stateCode ?? place?.stateCode;
    }
    if (!stateCode) {
      throw new BadRequestException(
        'Falta el código de departamento del destino',
      );
    }

    const destination: EnviaAddress = {
      name: (
        addr.recipientName ||
        order.customer.name ||
        order.customer.email
      ).slice(0, 80),
      phone,
      email: order.customer.email,
      street: addr.line1,
      ...(addr.line2 && { reference: addr.line2 }),
      city: cityCode,
      state: stateCode,
      country: 'CO',
      // Envia usa el código DANE también como código postal en Colombia.
      postalCode: cityCode,
    };

    const defaults = account.package;
    const weight =
      overrides.weightKg ??
      packageWeightKg(order.items, defaults.packagingGrams);
    const packages: EnviaPackage[] = [
      {
        type: 'box',
        content: 'Café',
        amount: 1,
        declaredValue: Math.max(1, Math.round(order.subtotalCents / 100)),
        lengthUnit: 'CM',
        weightUnit: 'KG',
        weight,
        dimensions: {
          length: overrides.lengthCm ?? defaults.lengthCm,
          width: overrides.widthCm ?? defaults.widthCm,
          height: overrides.heightCm ?? defaults.heightCm,
        },
      },
    ];
    return { destination, packages };
  }

  private originAddress(account: EnviaAccount): EnviaAddress {
    const o = account.origin;
    return {
      name: o.name,
      ...(o.company && { company: o.company }),
      phone: o.phone.replace(/[^\d]/g, ''),
      ...(o.email && { email: o.email }),
      street: o.street,
      ...(o.reference && { reference: o.reference }),
      city: o.cityCode,
      state: o.stateCode,
      country: 'CO',
      postalCode: o.cityCode,
      ...(o.identificationNumber && {
        identificationNumber: o.identificationNumber,
      }),
    };
  }

  private toHttpError(err: unknown, fallback: string) {
    if (err instanceof EnviaApiError) {
      if (err.status === 401) {
        return new BadRequestException(
          'Envia rechazó el token de la tienda. Reconéctalo en Configuración → Envíos.',
        );
      }
      if (err.status >= 500)
        return new BadGatewayException(`${fallback}: ${err.message}`);
      return new BadRequestException(`${fallback}: ${err.message}`);
    }
    return err instanceof Error ? err : new BadGatewayException(fallback);
  }
}
