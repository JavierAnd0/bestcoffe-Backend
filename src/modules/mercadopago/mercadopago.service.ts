import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { MercadoPagoConfig, OAuth, Payment } from 'mercadopago';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { inngest } from '../inngest/inngest.client';
import type { MpPaymentInputDto } from '../orders/dto/create-order.dto';

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
};

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
  ) {}

  private client(accessToken: string): MercadoPagoConfig {
    return new MercadoPagoConfig({ accessToken });
  }

  // ─── OAuth: conexión de la cuenta del vendedor (marketplace) ────────────────

  /** Genera la URL de autorización con un `state` firmado (anti-CSRF, atado al tenant). */
  async buildConnectUrl(tenantId: string): Promise<string> {
    const clientId = this.config.get<string>('mercadopago.clientId');
    const redirectUri = this.config.get<string>('mercadopago.redirectUri');
    if (!clientId || !redirectUri) {
      throw new BadRequestException('MercadoPago no está configurado en la plataforma');
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
      const payload = await this.jwt.verifyAsync<{ sub: string; purpose: string }>(
        state,
        { secret: this.config.get<string>('jwt.secret') },
      );
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

  private async persistCreds(tenantId: string, creds: MpOAuthCredentials): Promise<void> {
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        mpUserId: String(creds.user_id),
        mpAccessToken: creds.access_token,
        mpRefreshToken: creds.refresh_token,
        mpPublicKey: creds.public_key,
        mpTokenExpiresAt: new Date(Date.now() + creds.expires_in * 1000),
        mpConnected: true,
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
      return tenant.mpAccessToken;
    }
    const oauth = new OAuth(this.client(''));
    const creds = (await oauth.refresh({
      body: {
        client_id: this.config.get<string>('mercadopago.clientId'),
        client_secret: this.config.get<string>('mercadopago.clientSecret'),
        refresh_token: tenant.mpRefreshToken,
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

  // ─── Pago transparente (Checkout API) ───────────────────────────────────────

  /**
   * Crea un pago en nombre de la tienda usando su access token + comisión de
   * marketplace. COP es zero-decimal → transaction_amount = centavos_db / 100.
   */
  async createPayment(
    orderId: string,
    input: MpPaymentInputDto,
  ): Promise<{ status: string; mpPaymentId: string; statusDetail: string }> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        tenant: {
          select: {
            id: true,
            mpAccessToken: true,
            mpRefreshToken: true,
            mpTokenExpiresAt: true,
          },
        },
        customer: { select: { email: true } },
      },
    });
    if (!order) throw new BadRequestException('Orden no encontrada');

    const accessToken = await this.getFreshAccessToken(order.tenant);
    const amount = Math.round(order.totalCents / 100);
    const feePct = this.config.get<number>('mercadopago.marketplaceFeePct') ?? 0;
    const applicationFee =
      feePct > 0 ? Math.round((amount * feePct) / 100) : undefined;

    const payment = new Payment(this.client(accessToken));
    const result = (await payment.create({
      body: {
        transaction_amount: amount,
        token: input.cardToken,
        installments: input.installments ?? 1,
        payment_method_id: input.paymentMethodId,
        ...(input.issuerId && { issuer_id: Number(input.issuerId) }),
        payer: { email: input.payerEmail ?? order.customer.email },
        external_reference: orderId,
        ...(applicationFee !== undefined && { application_fee: applicationFee }),
        metadata: { orderId, tenantId: order.tenantId },
      },
      requestOptions: { idempotencyKey: orderId },
    })) as unknown as MpPaymentResult;

    await this.applyPaymentStatus(
      orderId,
      String(result.id),
      result.status,
    );

    return {
      status: result.status,
      mpPaymentId: String(result.id),
      statusDetail: result.status_detail,
    };
  }

  // ─── Webhook ────────────────────────────────────────────────────────────────

  async handleWebhook(
    query: Record<string, string>,
    headers: Record<string, string>,
    body: { type?: string; data?: { id?: string } } | undefined,
  ): Promise<void> {
    if (!this.verifySignature(query, headers)) {
      throw new BadRequestException('Firma de webhook inválida');
    }

    const type = query['type'] ?? body?.type;
    if (type !== 'payment') return;

    const paymentId = query['data.id'] ?? body?.data?.id;
    if (!paymentId) return;

    // El pago ya quedó asociado a la orden en createPayment; de ahí sacamos el
    // tenant (y su token) para consultar el estado real en MercadoPago.
    const order = await this.prisma.order.findFirst({
      where: { mpPaymentId: paymentId },
      include: {
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
    if (!order) {
      this.logger.warn(`Webhook MP: pago ${paymentId} sin orden asociada`);
      return;
    }

    const accessToken = await this.getFreshAccessToken(order.tenant);
    const payment = new Payment(this.client(accessToken));
    const got = (await payment.get({ id: paymentId })) as unknown as MpPaymentResult;

    await this.applyPaymentStatus(order.id, paymentId, got.status);
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
    const expected = createHmac('sha256', secret).update(manifest).digest('hex');
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
    let paymentStatus: Prisma.OrderUpdateInput['paymentStatus'];
    if (mpStatus === 'rejected' || mpStatus === 'cancelled') {
      paymentStatus = 'FAILED';
    } else if (mpStatus === 'refunded' || mpStatus === 'charged_back') {
      paymentStatus = 'REFUNDED';
    } else {
      paymentStatus = 'PENDING'; // pending / in_process / authorized
    }
    await this.prisma.order.update({
      where: { id: orderId },
      data: { paymentStatus, mpPaymentId },
    });
  }

  /** Marca PAID + decremento de stock + uso de descuento, idempotente. */
  private async markOrderPaid(orderId: string, mpPaymentId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Idempotencia: si el pago ya fue contabilizado, salir.
      try {
        await tx.mercadoPagoEvent.create({
          data: { id: mpPaymentId, type: 'payment.approved' },
        });
      } catch {
        return;
      }

      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: true },
      });
      if (!order) return;

      await tx.order.update({
        where: { id: orderId },
        data: { paymentStatus: 'PAID', mpPaymentId },
      });

      for (const item of order.items) {
        await tx.productVariant.updateMany({
          where: { id: item.variantId, stock: { gt: 0 } },
          data: { stock: { decrement: item.quantity } },
        });
      }

      if (order.discountCode) {
        await tx.discountCode.updateMany({
          where: { tenantId: order.tenantId, code: order.discountCode },
          data: { timesRedeemed: { increment: 1 } },
        });
      }
    });

    try {
      await inngest.send({ name: 'order/created', data: { orderId } });
    } catch (err) {
      this.logger.error('inngest.send order/created falló', err);
    }
  }
}
