import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { MercadoPagoConfig, OAuth, Payment, Preference } from 'mercadopago';
import { PaymentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { deriveSecretBoxKey, open, seal } from '../../common/crypto/secret-box';
import { OrderSettlementService } from '../orders/order-settlement.service';

// El SDK de MercadoPago no tipa estos retornos de forma cómoda; declaramos lo
// mínimo que consumimos y casteamos con `as unknown as`.
type MpOAuthCredentials = {
  access_token: string;
  refresh_token: string;
  user_id: number;
  public_key: string;
  expires_in: number;
};
type MpPaymentResult = {
  id: number;
  status: string; // approved | pending | in_process | authorized | rejected | cancelled | refunded | charged_back
  status_detail: string;
  external_reference?: string | null;
};

type MpPreferenceResult = { id: string; init_point: string };

/** Origen (`https://host[:puerto]`) de una URL http(s), o null si no lo es. */
function safeOrigin(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.origin;
  } catch {
    return null;
  }
}

type TenantMpCreds = {
  id: string;
  mpAccessToken: string | null;
  mpRefreshToken: string | null;
  mpTokenExpiresAt: Date | null;
};

const MP_AUTH_BASE = 'https://auth.mercadopago.com/authorization';
const TOKEN_REFRESH_MARGIN_MS = 60_000;

@Injectable()
export class MercadoPagoService {
  private readonly logger = new Logger(MercadoPagoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly settlement: OrderSettlementService,
  ) {}

  /** Clave de cifrado de los tokens OAuth guardados (ver secret-box.ts). */
  private readonly boxKey = deriveSecretBoxKey();

  private client(accessToken: string): MercadoPagoConfig {
    return new MercadoPagoConfig({ accessToken });
  }

  // ─── OAuth: conexión de la cuenta del vendedor (marketplace) ────────────────

  /** Genera la URL de autorización con un `state` firmado (anti-CSRF, atado al tenant). */
  async buildConnectUrl(tenantId: string): Promise<string> {
    const clientId = this.config.get<string>('mercadopago.clientId');
    const redirectUri = this.config.get<string>('mercadopago.redirectUri');
    if (!clientId || !redirectUri) {
      throw new BadRequestException(
        'MercadoPago no está configurado en la plataforma',
      );
    }
    const state = await this.jwt.signAsync(
      { sub: tenantId, purpose: 'mp-oauth' },
      { expiresIn: '15m' },
    );
    const url = new URL(MP_AUTH_BASE);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('platform_id', 'mp');
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    return url.toString();
  }

  /** Valida el `state` del callback OAuth y devuelve el tenantId. */
  async resolveOAuthState(state: string): Promise<string> {
    try {
      const payload = await this.jwt.verifyAsync<{
        sub: string;
        purpose: string;
      }>(state, { secret: this.config.get<string>('jwt.secret') });
      if (payload.purpose !== 'mp-oauth') throw new Error('purpose');
      return payload.sub;
    } catch {
      throw new UnauthorizedException('Estado OAuth inválido o expirado');
    }
  }

  /** Intercambia el `code` por tokens y los persiste en el tenant. */
  async exchangeCodeAndStore(tenantId: string, code: string): Promise<void> {
    const oauth = new OAuth(this.client(''));
    const creds = (await oauth.create({
      body: {
        client_id: this.config.get<string>('mercadopago.clientId'),
        client_secret: this.config.get<string>('mercadopago.clientSecret'),
        code,
        redirect_uri: this.config.get<string>('mercadopago.redirectUri'),
      },
    })) as unknown as MpOAuthCredentials;
    await this.persistCreds(tenantId, creds);
  }

  private async persistCreds(
    tenantId: string,
    creds: MpOAuthCredentials,
  ): Promise<void> {
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        mpUserId: String(creds.user_id),
        // Los tokens se guardan cifrados: una fuga de la base no los expone.
        mpAccessToken: seal(creds.access_token, this.boxKey),
        mpRefreshToken: seal(creds.refresh_token, this.boxKey),
        mpPublicKey: creds.public_key,
        mpTokenExpiresAt: new Date(Date.now() + creds.expires_in * 1000),
        mpConnected: true,
        // Conectar MercadoPago lo deja como pasarela de la tienda (el valor por
        // defecto es STRIPE, que está apagado para tiendas: sin esto el pedido
        // quedaba manual aunque la cuenta estuviera conectada).
        paymentProvider: 'MERCADOPAGO',
      },
    });
  }

  /** Refresca el access token si está por expirar; devuelve uno válido. */
  private async getFreshAccessToken(tenant: TenantMpCreds): Promise<string> {
    if (!tenant.mpAccessToken || !tenant.mpRefreshToken) {
      throw new BadRequestException('La tienda no tiene MercadoPago conectado');
    }
    const expMs = tenant.mpTokenExpiresAt?.getTime() ?? 0;
    if (expMs - Date.now() > TOKEN_REFRESH_MARGIN_MS) {
      return open(tenant.mpAccessToken, this.boxKey);
    }
    const oauth = new OAuth(this.client(''));
    const creds = (await oauth.refresh({
      body: {
        client_id: this.config.get<string>('mercadopago.clientId'),
        client_secret: this.config.get<string>('mercadopago.clientSecret'),
        refresh_token: open(tenant.mpRefreshToken, this.boxKey),
      },
    })) as unknown as MpOAuthCredentials;
    await this.persistCreds(tenant.id, creds);
    return creds.access_token;
  }

  async getConnectionStatus(tenantId: string) {
    const t = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { mpConnected: true, mpUserId: true, mpPublicKey: true },
    });
    return {
      connected: t.mpConnected,
      userId: t.mpUserId,
      publicKey: t.mpPublicKey, // el frontend la necesita para tokenizar
    };
  }

  async disconnect(tenantId: string): Promise<{ disconnected: true }> {
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        mpConnected: false,
        mpAccessToken: null,
        mpRefreshToken: null,
        mpTokenExpiresAt: null,
        mpUserId: null,
        mpPublicKey: null,
      },
    });
    return { disconnected: true };
  }

  // ─── Checkout Pro ───────────────────────────────────────────────────────────

  /**
   * Crea la preferencia de Checkout Pro de un pedido, en la cuenta de la
   * tienda y con la comisión de la plataforma. El comprador paga en la página
   * de MercadoPago con lo que tenga (tarjetas guardadas, saldo, PSE, Nequi,
   * Efecty…) y vuelve a la confirmación de la tienda.
   *
   * MercadoPago recibe pesos, no centavos: unit_price = centavos / 100.
   */
  async createPreference(
    orderId: string,
    opts: { returnOrigin?: string } = {},
  ): Promise<{ preferenceId: string; checkoutUrl: string }> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        tenant: {
          select: {
            id: true,
            name: true,
            mpAccessToken: true,
            mpRefreshToken: true,
            mpTokenExpiresAt: true,
            billingType: true,
            commissionPct: true,
          },
        },
        customer: { select: { email: true, name: true } },
      },
    });
    if (!order) throw new BadRequestException('Orden no encontrada');

    const accessToken = await this.getFreshAccessToken(order.tenant);
    const amount = Math.round(order.totalCents / 100);
    // Comisión de la plataforma sobre esta venta. Una tienda en modalidad
    // COMISIÓN paga el % que ELLA aceptó (commissionPct), no uno global; las
    // demás (suscripción / pago único) usan el % de marketplace general, si hay.
    const feePct =
      order.tenant.billingType === 'COMMISSION' &&
      order.tenant.commissionPct != null
        ? order.tenant.commissionPct
        : (this.config.get<number>('mercadopago.marketplaceFeePct') ?? 0);
    const marketplaceFee =
      feePct > 0 ? Math.round((amount * feePct) / 100) : undefined;

    const back = await this.returnBase(
      order.tenantId,
      orderId,
      opts.returnOrigin,
    );
    // auto_return solo se acepta con una URL de éxito HTTPS (en local, el
    // comprador vuelve con el botón «Volver a la tienda» de MercadoPago).
    const httpsBack = back.startsWith('https://');
    const code = orderId.slice(-8).toUpperCase();

    const preference = new Preference(this.client(accessToken));
    const result = (await preference.create({
      body: {
        // Una sola línea con el total ya cotizado (envío y cupón incluidos):
        // MercadoPago cobra exactamente lo que dice el pedido.
        items: [
          {
            id: orderId,
            title: `Pedido #${code} · ${order.tenant.name}`,
            quantity: 1,
            unit_price: amount,
            currency_id: 'COP',
          },
        ],
        payer: { email: order.customer.email },
        external_reference: orderId,
        metadata: { orderId, tenantId: order.tenantId },
        back_urls: {
          success: `${back}&pago=aprobado`,
          pending: `${back}&pago=pendiente`,
          failure: `${back}&pago=fallido`,
        },
        ...(httpsBack && { auto_return: 'approved' }),
        statement_descriptor: order.tenant.name.slice(0, 22),
        ...(marketplaceFee !== undefined && {
          marketplace_fee: marketplaceFee,
        }),
      },
      requestOptions: { idempotencyKey: `pref-${orderId}` },
    })) as unknown as MpPreferenceResult;

    return { preferenceId: result.id, checkoutUrl: result.init_point };
  }

  /**
   * Al volver de MercadoPago, la confirmación pide el estado real del pago
   * (sin esperar el webhook). Solo se aplica si el pago es de esa tienda y su
   * `external_reference` es ese pedido.
   */
  async syncPayment(
    tenantId: string,
    orderId: string,
    paymentId: string,
  ): Promise<{ paymentStatus: PaymentStatus | null; mpStatus: string | null }> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId },
      select: {
        id: true,
        tenant: {
          select: {
            id: true,
            mpAccessToken: true,
            mpRefreshToken: true,
            mpTokenExpiresAt: true,
          },
        },
      },
    });
    if (!order) return { paymentStatus: null, mpStatus: null };

    let got: MpPaymentResult;
    try {
      got = await this.fetchPayment(order.tenant, paymentId);
    } catch (err) {
      this.logger.warn(
        `Sync MP: no se pudo consultar el pago ${paymentId} del pedido ${orderId}: ${String(err)}`,
      );
      return this.currentStatus(orderId, null);
    }
    if (got.external_reference !== orderId) {
      this.logger.warn(
        `Sync MP: el pago ${paymentId} no es del pedido ${orderId} (referencia ${got.external_reference ?? '—'})`,
      );
      return this.currentStatus(orderId, null);
    }
    await this.applyPaymentStatus(orderId, paymentId, got.status);
    return this.currentStatus(orderId, got.status);
  }

  private async currentStatus(orderId: string, mpStatus: string | null) {
    const o = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { paymentStatus: true },
    });
    return { paymentStatus: o?.paymentStatus ?? null, mpStatus };
  }

  /**
   * Base de la URL de regreso a la confirmación. Solo se acepta un origen que
   * sea la web de la plataforma o un dominio verificado de la tienda; en otro
   * caso se usa la web de la plataforma.
   */
  private async returnBase(
    tenantId: string,
    orderId: string,
    requested?: string,
  ): Promise<string> {
    const webUrl = this.config.get<string>('webAppUrl') ?? '';
    let origin = safeOrigin(webUrl) ?? '';
    const asked = requested ? safeOrigin(requested) : null;
    if (asked && asked !== origin) {
      const host = new URL(asked).hostname;
      const isLocal =
        this.config.get<string>('nodeEnv') !== 'production' &&
        (host === 'localhost' ||
          host === '127.0.0.1' ||
          host.endsWith('.localhost'));
      const domain = isLocal
        ? null
        : await this.prisma.tenantDomain.findFirst({
            where: { tenantId, domain: host, verified: true },
            select: { id: true },
          });
      if (isLocal || domain) origin = asked;
    }
    return `${origin}/checkout/confirmacion?orderId=${encodeURIComponent(orderId)}`;
  }

  // ─── Webhook ────────────────────────────────────────────────────────────────

  async handleWebhook(
    query: Record<string, string>,
    headers: Record<string, string>,
    body:
      | { type?: string; data?: { id?: string }; user_id?: string | number }
      | undefined,
  ): Promise<void> {
    if (!this.verifySignature(query, headers)) {
      throw new BadRequestException('Firma de webhook inválida');
    }

    const type = query['type'] ?? body?.type;
    if (type !== 'payment') return;

    const paymentId = query['data.id'] ?? body?.data?.id;
    if (!paymentId) return;

    const tenantSelect = {
      id: true,
      mpAccessToken: true,
      mpRefreshToken: true,
      mpTokenExpiresAt: true,
    } as const;

    // Camino normal: createPayment ya guardó el id del pago en la orden.
    const order = await this.prisma.order.findFirst({
      where: { mpPaymentId: paymentId },
      select: { id: true, tenant: { select: tenantSelect } },
    });
    if (order) {
      const got = await this.fetchPayment(order.tenant, paymentId);
      await this.applyPaymentStatus(order.id, paymentId, got.status);
      return;
    }

    // Carrera: el aviso llegó antes de que createPayment guardara el id (o la
    // respuesta se perdió). El aviso trae el `user_id` del vendedor: con él se
    // halla la tienda, se consulta el pago con su token y la orden sale de
    // `external_reference`.
    const sellerId = body?.user_id != null ? String(body.user_id) : null;
    const tenant = sellerId
      ? await this.prisma.tenant.findFirst({
          where: { mpUserId: sellerId, mpConnected: true },
          select: tenantSelect,
        })
      : null;
    if (!tenant) {
      this.logger.warn(`Webhook MP: pago ${paymentId} sin orden asociada`);
      return;
    }
    const got = await this.fetchPayment(tenant, paymentId);
    const orderId = got.external_reference;
    const owned = orderId
      ? await this.prisma.order.findFirst({
          where: { id: orderId, tenantId: tenant.id },
          select: { id: true },
        })
      : null;
    if (!owned) {
      this.logger.warn(
        `Webhook MP: pago ${paymentId} con referencia ${orderId ?? '—'} que no es de la tienda ${tenant.id}`,
      );
      return;
    }
    await this.applyPaymentStatus(owned.id, paymentId, got.status);
  }

  private async fetchPayment(
    tenant: TenantMpCreds,
    paymentId: string,
  ): Promise<MpPaymentResult> {
    const accessToken = await this.getFreshAccessToken(tenant);
    const payment = new Payment(this.client(accessToken));
    return (await payment.get({ id: paymentId })) as unknown as MpPaymentResult;
  }

  /** HMAC-SHA256 del manifest `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`. */
  private verifySignature(
    query: Record<string, string>,
    headers: Record<string, string>,
  ): boolean {
    const secret = this.config.get<string>('mercadopago.webhookSecret');
    if (!secret) {
      this.logger.warn('MP_WEBHOOK_SECRET no configurado — webhook ignorado');
      return false;
    }
    const signature = headers['x-signature'];
    const requestId = headers['x-request-id'];
    if (!signature) return false;

    const parts: Record<string, string> = {};
    for (const kv of signature.split(',')) {
      const [k, v] = kv.split('=');
      if (k && v) parts[k.trim()] = v.trim();
    }
    const ts = parts['ts'];
    const v1 = parts['v1'];
    if (!ts || !v1) return false;

    const dataId = (query['data.id'] ?? '').toLowerCase();
    const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
    const expected = createHmac('sha256', secret)
      .update(manifest)
      .digest('hex');
    try {
      return timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
    } catch {
      return false;
    }
  }

  // ─── Estado del pago → orden ────────────────────────────────────────────────

  private async applyPaymentStatus(
    orderId: string,
    mpPaymentId: string,
    mpStatus: string,
  ): Promise<void> {
    if (mpStatus === 'approved') {
      await this.markOrderPaid(orderId, mpPaymentId);
      return;
    }
    // Con Checkout Pro un rechazo no cierra el pedido: el comprador puede
    // intentar con otro medio en la misma página de MercadoPago. El pedido
    // sigue pendiente hasta que un pago se apruebe.
    if (mpStatus === 'rejected' || mpStatus === 'cancelled') return;
    let paymentStatus: PaymentStatus;
    if (mpStatus === 'refunded' || mpStatus === 'charged_back') {
      paymentStatus = 'REFUNDED';
    } else {
      paymentStatus = 'PENDING'; // pending / in_process / authorized
    }
    // Los avisos pueden llegar desordenados: un pedido ya pagado solo puede
    // pasar a reembolsado, nunca volver a pendiente o fallido.
    await this.prisma.order.updateMany({
      where: {
        id: orderId,
        ...(paymentStatus !== 'REFUNDED' && {
          paymentStatus: { notIn: ['PAID', 'REFUNDED'] },
        }),
      },
      data: { paymentStatus, mpPaymentId },
    });
  }

  /** Marca PAID + decremento de stock + uso de descuento, idempotente. */
  private async markOrderPaid(
    orderId: string,
    mpPaymentId: string,
  ): Promise<void> {
    await this.settlement.settlePaidOrder(orderId, {
      provider: 'MERCADOPAGO',
      eventId: mpPaymentId,
      eventType: 'payment.approved',
      mpPaymentId,
    });
  }
}
