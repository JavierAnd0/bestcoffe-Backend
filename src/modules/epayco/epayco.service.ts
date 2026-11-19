import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'node:crypto';
import { PaymentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { deriveSecretBoxKey, open, seal } from '../../common/crypto/secret-box';
import { checkoutReturnBase } from '../../common/checkout/return-url';
import { OrderSettlementService } from '../orders/order-settlement.service';
import type { SaveEpaycoKeysDto } from './dto/save-keys.dto';

/**
 * ePayco (DaviPay) — Checkout v2.
 *
 * Flujo:
 *  1. El checkout crea el pedido PENDING y pide aquí una sesión
 *     (`apify.epayco.co/login` + `/payment/session/create`) con las llaves de
 *     la tienda. El front abre la pasarela con `checkout-v2.js` y ese
 *     `sessionId`.
 *  2. ePayco avisa el resultado servidor a servidor (URL de confirmación) y
 *     devuelve al comprador a la confirmación con `?ref_payco=…` (sync).
 *  3. En los dos casos NO se confía en los parámetros recibidos: con el
 *     `ref_payco` se consulta la transacción a ePayco y se valida que sea de
 *     esa tienda (Customer ID + firma con su P_KEY), de ese pedido, por su
 *     monto exacto en COP y, si la tienda está en producción, que no sea de
 *     prueba. Solo entonces se liquida el pedido.
 */

const APIFY_BASE = 'https://apify.epayco.co';
const VALIDATION_BASE = 'https://secure.epayco.co/validation/v1/reference';
const HTTP_TIMEOUT_MS = 10_000;

/** Lo que consumimos de la transacción que devuelve la validación de ePayco. */
export type EpaycoTransaction = {
  x_ref_payco?: string | number;
  x_id_invoice?: string;
  x_extra1?: string;
  x_cust_id_cliente?: string | number;
  x_transaction_id?: string | number;
  x_amount?: string | number;
  x_currency_code?: string;
  x_response?: string;
  x_cod_response?: string | number;
  x_signature?: string;
  x_test_request?: string | boolean;
};

type TenantEpaycoCreds = {
  id: string;
  epaycoCustomerId: string | null;
  epaycoPKey: string | null;
  epaycoPublicKey: string | null;
  epaycoPrivateKey: string | null;
  epaycoTest: boolean;
  epaycoConnected: boolean;
};

const tenantCredsSelect = {
  id: true,
  epaycoCustomerId: true,
  epaycoPKey: true,
  epaycoPublicKey: true,
  epaycoPrivateKey: true,
  epaycoTest: true,
  epaycoConnected: true,
} as const;

/** Monto en pesos que se cobra por un pedido (ePayco recibe pesos, no centavos). */
export function epaycoAmount(totalCents: number): number {
  return Math.round(totalCents / 100);
}

/**
 * Firma de ePayco:
 * SHA256(p_cust_id_cliente^p_key^x_ref_payco^x_transaction_id^x_amount^x_currency_code)
 */
export function epaycoSignature(
  customerId: string,
  pKey: string,
  tx: EpaycoTransaction,
): string {
  return createHash('sha256')
    .update(
      [
        customerId,
        pKey,
        tx.x_ref_payco,
        tx.x_transaction_id,
        tx.x_amount,
        tx.x_currency_code,
      ]
        .map((v) => String(v ?? ''))
        .join('^'),
    )
    .digest('hex');
}

type EpaycoShippingAddress = {
  recipientName?: string;
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  phone?: string;
};

/**
 * `billing` de la sesión de ePayco con lo que el comprador escribió en el
 * checkout: quién recibe, su teléfono y la dirección del pedido. El nombre del
 * perfil solo se usa si la dirección no trae uno (pedidos antiguos).
 */
export function epaycoBilling(
  customer: { email: string; name: string | null },
  address: EpaycoShippingAddress | null,
  document?: { type: string; number: string },
) {
  const name = (address?.recipientName || customer.name || '').trim();
  // ePayco pide el celular sin indicativo: 10 dígitos en Colombia.
  let phone = (address?.phone ?? '').replace(/\D/g, '');
  if (phone.length === 12 && phone.startsWith('57')) phone = phone.slice(2);
  const street = [address?.line1, address?.line2, address?.city, address?.state]
    .map((p) => p?.trim())
    .filter(Boolean)
    .join(', ');
  return {
    email: customer.email,
    ...(name && { name: name.slice(0, 100) }),
    ...(street && { address: street.slice(0, 200) }),
    ...(/^\d{7,10}$/.test(phone) && {
      callingCode: '+57',
      mobilePhone: phone,
    }),
    ...(document && {
      typeDoc: document.type,
      numberDoc: document.number,
    }),
  };
}

function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a.toLowerCase());
  const bb = Buffer.from(b.toLowerCase());
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Estado de ePayco (`x_response` o `x_cod_response`) → acción sobre el pedido. */
export function mapEpaycoState(
  tx: EpaycoTransaction,
): 'PAID' | 'PENDING' | 'FAILED' | 'REFUNDED' | 'IGNORE' {
  const text = String(tx.x_response ?? '')
    .trim()
    .toLowerCase();
  const code = Number(tx.x_cod_response);
  if (text === 'aceptada' || code === 1) return 'PAID';
  if (text === 'pendiente' || code === 3) return 'PENDING';
  if (text === 'reversada' || code === 6) return 'REFUNDED';
  if (
    ['rechazada', 'fallida', 'expirada', 'abandonada', 'cancelada'].includes(
      text,
    ) ||
    [2, 4, 9, 10, 11].includes(code)
  ) {
    return 'FAILED';
  }
  return 'IGNORE'; // Iniciada u otro estado intermedio
}

@Injectable()
export class EpaycoService {
  private readonly logger = new Logger(EpaycoService.name);
  private readonly boxKey = deriveSecretBoxKey();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly settlement: OrderSettlementService,
  ) {}

  // ─── Llaves de la tienda ────────────────────────────────────────────────────

  /**
   * Guarda las llaves de ePayco de la tienda. Antes de guardarlas se prueba
   * el login de Apify con la llave pública y la privada, para que un error de
   * copiado salga aquí y no en el checkout de un cliente.
   */
  async saveKeys(tenantId: string, dto: SaveEpaycoKeysDto) {
    const publicKey = dto.publicKey.trim();
    const privateKey = dto.privateKey.trim();
    try {
      await this.login(publicKey, privateKey);
    } catch {
      throw new BadRequestException(
        'ePayco rechazó la llave pública o la privada. Revísalas en tu panel de ePayco (Configuración → Personalizaciones → Llaves secretas).',
      );
    }
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        epaycoCustomerId: dto.customerId.trim(),
        epaycoPKey: seal(dto.pKey.trim(), this.boxKey),
        epaycoPublicKey: publicKey,
        epaycoPrivateKey: seal(privateKey, this.boxKey),
        epaycoTest: dto.test,
        epaycoConnected: true,
        // Conectar ePayco la deja como pasarela de la tienda (igual que MP).
        paymentProvider: 'EPAYCO',
      },
    });
    return this.getConnectionStatus(tenantId);
  }

  async getConnectionStatus(tenantId: string) {
    const t = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: {
        epaycoConnected: true,
        epaycoCustomerId: true,
        epaycoPublicKey: true,
        epaycoTest: true,
        paymentProvider: true,
      },
    });
    return {
      connected: t.epaycoConnected,
      customerId: t.epaycoCustomerId,
      publicKey: t.epaycoPublicKey,
      test: t.epaycoTest,
      active: t.epaycoConnected && t.paymentProvider === 'EPAYCO',
    };
  }

  async disconnect(tenantId: string): Promise<{ disconnected: true }> {
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        epaycoConnected: false,
        epaycoCustomerId: null,
        epaycoPKey: null,
        epaycoPublicKey: null,
        epaycoPrivateKey: null,
        epaycoTest: true,
      },
    });
    return { disconnected: true };
  }

  // ─── Sesión de checkout ─────────────────────────────────────────────────────

  /**
   * Crea la sesión de Checkout v2 de un pedido en la cuenta de la tienda. El
   * front abre la pasarela con este `sessionId` (y `test`).
   */
  async createSession(
    orderId: string,
    opts: {
      returnOrigin?: string;
      /** Documento del pagador: se reenvía a ePayco y no se guarda. */
      payerDocument?: { type: string; number: string };
    } = {},
  ): Promise<{ sessionId: string; test: boolean }> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        tenant: { select: { ...tenantCredsSelect, name: true } },
        customer: { select: { email: true, name: true } },
      },
    });
    if (!order) throw new BadRequestException('Orden no encontrada');
    const { tenant } = order;
    if (!tenant.epaycoConnected || !tenant.epaycoPublicKey) {
      throw new BadRequestException('La tienda no tiene ePayco conectado');
    }

    const token = await this.login(
      tenant.epaycoPublicKey,
      this.reveal(tenant.epaycoPrivateKey),
    );

    let back = await checkoutReturnBase(
      this.prisma,
      this.config,
      order.tenantId,
      orderId,
      opts.returnOrigin,
    );
    // ePayco rechaza `localhost` como URL de respuesta ("is not a valid URL");
    // en desarrollo se usa la IP de loopback, que sí acepta.
    if (this.config.get<string>('nodeEnv') !== 'production') {
      back = back.replace(/^(https?:\/\/)localhost(?=[:/])/, '$1127.0.0.1');
    }
    const confirmation = this.config.get<string>('epayco.confirmationUrl');
    const code = orderId.slice(-8).toUpperCase();

    const body = {
      checkout_version: '2',
      name: tenant.name.slice(0, 60),
      description: `Pedido #${code} · ${tenant.name}`.slice(0, 120),
      // Una sola línea con el total ya cotizado (envío y cupón incluidos).
      amount: epaycoAmount(order.totalCents),
      currency: 'COP',
      country: 'CO',
      lang: 'ES',
      // El pedido viaja como factura y en extra1: es lo que se valida después.
      invoice: orderId,
      taxBase: 0,
      tax: 0,
      taxIco: 0,
      // ePayco agrega `?ref_payco=…` (o `&ref_payco=…`) a esta URL.
      response: `${back}&pago=epayco`,
      ...(confirmation && { confirmation }),
      method: 'POST',
      extras: { extra1: orderId, extra2: order.tenantId },
      // Datos del comprador para prellenar la pasarela: los que escribió en
      // este checkout (dirección del pedido), no los del perfil del cliente.
      billing: epaycoBilling(
        order.customer,
        order.shippingAddress as EpaycoShippingAddress | null,
        opts.payerDocument,
      ),
    };

    const res = await this.apify<{
      data?: { sessionId?: string };
      textResponse?: string;
    }>('/payment/session/create', token, body);
    const sessionId = res.data?.sessionId;
    if (!sessionId) {
      const safeDetails = {
        hasData: Boolean(res?.data),
        hasSessionId: Boolean(res?.data?.sessionId),
        textResponse:
          typeof res?.textResponse === 'string'
            ? res.textResponse.slice(0, 300)
            : undefined,
      };
      this.logger.error(
        `ePayco no creó la sesión del pedido ${orderId}: ${JSON.stringify(safeDetails)}`,
      );
      throw new BadGatewayException(
        'No se pudo iniciar el pago con ePayco. Intenta nuevamente.',
      );
    }
    return { sessionId, test: tenant.epaycoTest };
  }

  // ─── Confirmación (webhook) y regreso del comprador ────────────────────────

  /**
   * URL de confirmación de ePayco (GET o POST, form o JSON). Solo se usa el
   * `ref_payco` del aviso; todo lo demás sale de la consulta a ePayco.
   */
  async handleConfirmation(params: Record<string, unknown>): Promise<void> {
    // El checkout nuevo de ePayco maneja dos referencias: `ref_payco` (hex),
    // que es la que responde la consulta, y `x_ref_payco` (numérica), que la
    // consulta no reconoce. Se prueban en ese orden.
    const refs = [...new Set([params['ref_payco'], params['x_ref_payco']])]
      .map((v) =>
        typeof v === 'string' || typeof v === 'number' ? String(v) : '',
      )
      .filter((v) => /^[A-Za-z0-9]{1,64}$/.test(v));
    if (refs.length === 0) {
      this.logger.warn('Confirmación ePayco sin ref_payco válido');
      return;
    }
    let tx: EpaycoTransaction | null = null;
    let lookupRef = '';
    for (const candidate of refs) {
      tx = await this.fetchTransaction(candidate);
      if (tx) {
        lookupRef = candidate;
        break;
      }
    }
    const ref = refs.join('/');
    if (!tx) {
      this.logger.warn(`Confirmación ePayco: ${ref} no existe en ePayco`);
      return;
    }
    const orderId = String(tx.x_id_invoice || tx.x_extra1 || '');
    const order = orderId
      ? await this.prisma.order.findUnique({
          where: { id: orderId },
          select: {
            id: true,
            totalCents: true,
            tenant: { select: tenantCredsSelect },
          },
        })
      : null;
    if (!order) {
      this.logger.warn(
        `Confirmación ePayco: ${ref} con factura ${orderId || '—'} sin pedido`,
      );
      return;
    }
    await this.applyVerified(order, lookupRef, tx);
  }

  /**
   * Al volver de ePayco la confirmación de la tienda (servidor a servidor)
   * consulta el estado real sin esperar el aviso. Solo aplica transacciones
   * de esa tienda y de ese pedido.
   */
  async syncPayment(
    tenantId: string,
    orderId: string,
    refPayco: string,
  ): Promise<{
    paymentStatus: PaymentStatus | null;
    epaycoStatus: string | null;
  }> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId },
      select: {
        id: true,
        totalCents: true,
        tenant: { select: tenantCredsSelect },
      },
    });
    if (!order) return { paymentStatus: null, epaycoStatus: null };

    let tx: EpaycoTransaction | null;
    try {
      tx = await this.fetchTransaction(refPayco);
    } catch (err) {
      this.logger.warn(
        `Sync ePayco: no se pudo consultar ${refPayco} del pedido ${orderId}: ${String(err)}`,
      );
      return this.currentStatus(orderId, null);
    }
    if (!tx) return this.currentStatus(orderId, null);
    const applied = await this.applyVerified(order, refPayco, tx);
    return this.currentStatus(
      orderId,
      applied ? (tx.x_response ?? null) : null,
    );
  }

  /**
   * Valida que la transacción sea legítima para ese pedido y la aplica.
   * Devuelve false (sin tocar el pedido) si algo no cuadra.
   *
   * Dos referencias: `lookupRef` es la que ePayco acepta en la consulta (se
   * guarda en el pedido para poder revisarlo después) y la canónica
   * (`x_ref_payco`) identifica el evento, así el aviso y el regreso del
   * comprador no se liquidan dos veces aunque lleguen con referencias distintas.
   */
  private async applyVerified(
    order: { id: string; totalCents: number; tenant: TenantEpaycoCreds },
    lookupRef: string,
    tx: EpaycoTransaction,
  ): Promise<boolean> {
    const { tenant } = order;
    const ref = String(tx.x_ref_payco ?? lookupRef);
    const reject = (why: string) => {
      this.logger.warn(`ePayco ${ref} → pedido ${order.id} rechazado: ${why}`);
      return false;
    };

    if (!tenant.epaycoCustomerId || !tenant.epaycoPKey) {
      return reject('la tienda no tiene llaves de ePayco');
    }
    const invoice = String(tx.x_id_invoice || tx.x_extra1 || '');
    if (invoice !== order.id) return reject(`es de la factura ${invoice}`);
    if (String(tx.x_cust_id_cliente ?? '') !== tenant.epaycoCustomerId) {
      return reject('es de otro comercio');
    }
    const expected = epaycoSignature(
      tenant.epaycoCustomerId,
      this.reveal(tenant.epaycoPKey),
      tx,
    );
    if (!tx.x_signature || !safeEqualHex(expected, String(tx.x_signature))) {
      return reject('firma inválida');
    }
    const isTestTx = String(tx.x_test_request ?? '').toLowerCase() === 'true';
    if (isTestTx && !tenant.epaycoTest) {
      return reject('transacción de prueba en una tienda en producción');
    }

    const state = mapEpaycoState(tx);
    if (state === 'PAID') {
      if (String(tx.x_currency_code ?? '').toUpperCase() !== 'COP') {
        return reject(`moneda ${tx.x_currency_code}`);
      }
      if (Number(tx.x_amount) !== epaycoAmount(order.totalCents)) {
        return reject(
          `monto ${tx.x_amount} ≠ ${epaycoAmount(order.totalCents)}`,
        );
      }
      await this.settlement.settlePaidOrder(order.id, {
        provider: 'EPAYCO',
        eventId: ref,
        eventType: 'transaction.accepted',
        epaycoRef: lookupRef,
      });
      return true;
    }
    if (state === 'IGNORE') return true;

    // Los avisos pueden llegar desordenados: un pedido pagado solo puede pasar
    // a reembolsado, nunca volver a pendiente o fallido; y solo se reembolsa
    // un pedido que estaba pagado con esa misma transacción.
    await this.prisma.order.updateMany({
      where:
        state === 'REFUNDED'
          ? { id: order.id, paymentStatus: 'PAID', epaycoRef: lookupRef }
          : { id: order.id, paymentStatus: { notIn: ['PAID', 'REFUNDED'] } },
      data: { paymentStatus: state, epaycoRef: lookupRef },
    });
    return true;
  }

  /**
   * Revisa contra ePayco los pedidos que siguen pendientes con una transacción
   * conocida (PSE en curso, efectivo por pagar…). Cubre el caso en que el
   * aviso servidor a servidor no llega (URL de confirmación sin configurar o
   * caída) y marca fallidos los pagos en efectivo que vencieron. Pasa por la
   * misma validación que el aviso y el regreso del comprador.
   */
  async reconcilePending(
    opts: { maxAgeDays?: number; limit?: number } = {},
  ): Promise<{ checked: number; changed: number; errors: number }> {
    // El efectivo puede quedar pendiente hasta 8 días antes de vencer.
    const since = new Date(Date.now() - (opts.maxAgeDays ?? 10) * 86_400_000);
    const orders = await this.prisma.order.findMany({
      where: {
        paymentStatus: 'PENDING',
        status: { not: 'CANCELLED' },
        epaycoRef: { not: null },
        createdAt: { gte: since },
        tenant: { epaycoConnected: true },
      },
      orderBy: { updatedAt: 'asc' },
      take: opts.limit ?? 100,
      select: {
        id: true,
        totalCents: true,
        epaycoRef: true,
        tenant: { select: tenantCredsSelect },
      },
    });

    let changed = 0;
    let errors = 0;
    for (const order of orders) {
      try {
        const tx = await this.fetchTransaction(order.epaycoRef!);
        if (!tx) continue;
        await this.applyVerified(order, order.epaycoRef!, tx);
        const now = await this.prisma.order.findUnique({
          where: { id: order.id },
          select: { paymentStatus: true },
        });
        if (now && now.paymentStatus !== 'PENDING') changed++;
      } catch (err) {
        errors++;
        this.logger.warn(
          `Revisión ePayco: no se pudo revisar el pedido ${order.id}: ${String(err)}`,
        );
      }
    }
    if (orders.length > 0) {
      this.logger.log(
        `Revisión ePayco: ${orders.length} pendientes, ${changed} cambiaron, ${errors} con error`,
      );
    }
    return { checked: orders.length, changed, errors };
  }

  private async currentStatus(orderId: string, epaycoStatus: string | null) {
    const o = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { paymentStatus: true },
    });
    return { paymentStatus: o?.paymentStatus ?? null, epaycoStatus };
  }

  // ─── HTTP ───────────────────────────────────────────────────────────────────

  /** Consulta una transacción por `ref_payco`. null si ePayco no la conoce. */
  async fetchTransaction(ref: string): Promise<EpaycoTransaction | null> {
    const res = await fetch(`${VALIDATION_BASE}/${encodeURIComponent(ref)}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    if (!res.ok) {
      if (res.status === 404) return null;
      throw new Error(`validación ePayco HTTP ${res.status}`);
    }
    // ePayco responde 200 también cuando no conoce la referencia (con
    // `status: false` y `data` sin transacción): se decide por el contenido.
    const json = (await res.json().catch(() => ({}))) as {
      data?: EpaycoTransaction;
    };
    if (!json.data?.x_ref_payco) return null;
    return json.data;
  }

  /** Login de Apify (Basic con llave pública:privada) → token Bearer. */
  private async login(publicKey: string, privateKey: string): Promise<string> {
    const basic = Buffer.from(`${publicKey}:${privateKey}`).toString('base64');
    const res = await fetch(`${APIFY_BASE}/login`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    const json = (await res.json().catch(() => ({}))) as { token?: string };
    if (!res.ok || !json.token) {
      throw new Error(`login ePayco HTTP ${res.status}`);
    }
    return json.token;
  }

  private async apify<T>(path: string, token: string, body: unknown) {
    const res = await fetch(`${APIFY_BASE}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    return (await res.json().catch(() => ({}))) as T;
  }

  private reveal(sealed: string | null): string {
    if (!sealed) throw new BadRequestException('Llaves de ePayco incompletas');
    return open(sealed, this.boxKey);
  }
}
