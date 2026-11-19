import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, ProductStatus, SubAvail, SubStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantFeaturesService } from '../../common/features/tenant-features.service';
import { CartService } from '../cart/cart.service';
import { StripeService } from '../stripe/stripe.service';
import { MercadoPagoService } from '../mercadopago/mercadopago.service';
import { EpaycoService } from '../epayco/epayco.service';
import {
  DEFAULT_SUBSCRIPTION_FREQUENCY_DAYS,
  type CreateGuestOrderDto,
  type CreateOrderDto,
} from './dto/create-order.dto';
import { PurchaseMode } from '../cart/dto/price-cart.dto';
import {
  AWAITING_FIRST_PAYMENT,
  isAwaitingFirstPayment,
} from '../subscriptions/subscription-first-order';
import { variantLabel } from './variant-label';

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cart: CartService,
    private readonly stripe: StripeService,
    private readonly mercadopago: MercadoPagoService,
    private readonly epayco: EpaycoService,
    private readonly config: ConfigService,
    private readonly features: TenantFeaturesService,
  ) {}

  /**
   * Pedido de invitado: compra sin sesión, identificada solo por un correo que
   * nadie ha verificado. Por eso este camino:
   *  - NO devuelve token ni sesión (antes el front pedía una sesión completa
   *    para el correo escrito en el checkout: cualquiera podía entrar a la
   *    cuenta de otro cliente);
   *  - no modifica un cliente existente (ni nombre, ni emailVerified);
   *  - no toca su carrito guardado;
   *  - solo admite compra única: una suscripción exige cuenta propia.
   */
  async createGuest(tenantId: string, dto: CreateGuestOrderDto) {
    if (dto.mode === PurchaseMode.SUBSCRIPTION) {
      throw new BadRequestException(
        'Para suscribirte necesitas iniciar sesión o crear una cuenta',
      );
    }

    const email = dto.email.toLowerCase().trim();

    // Si el correo ya pertenece a una CUENTA real (con contraseña o verificado
    // por Google), el pedido de invitado no se puede colgar de ella: nadie ha
    // probado que el correo sea de quien compra, y quedaría en su historial y
    // gastaría sus cupones de un solo uso. Debe iniciar sesión.
    const existing = await this.prisma.customer.findUnique({
      where: { tenantId_email: { tenantId, email } },
      select: { passwordHash: true, emailVerified: true },
    });
    if (existing && (existing.passwordHash || existing.emailVerified)) {
      throw new ConflictException(
        'Ya existe una cuenta con este correo. Inicia sesión para continuar con tu compra.',
      );
    }

    // upsert con update vacío: dos pedidos de invitado simultáneos con el mismo
    // correo nuevo no chocan con @@unique([tenantId, email]).
    const customer = await this.prisma.customer.upsert({
      where: { tenantId_email: { tenantId, email } },
      update: {},
      create: { tenantId, email, name: dto.name?.trim() || null },
      select: { id: true },
    });

    return this.create(tenantId, customer.id, dto, { guest: true });
  }

  async create(
    tenantId: string,
    customerId: string,
    dto: CreateOrderDto,
    opts: { guest?: boolean } = {},
  ) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: {
        paymentProvider: true,
        mpConnected: true,
        epaycoConnected: true,
      },
    });

    // Pedido por suscripción: exige cuenta, la capacidad del plan y que cada
    // línea sea suscribible. Se valida antes de cotizar para no ofrecer el
    // precio de suscripción sin una suscripción real detrás.
    const isSubscription = dto.mode === PurchaseMode.SUBSCRIPTION;
    if (isSubscription) {
      if (opts.guest) {
        throw new BadRequestException(
          'Para suscribirte necesitas iniciar sesión o crear una cuenta',
        );
      }
      const { subscriptions } = await this.features.get(tenantId);
      if (!subscriptions) {
        throw new HttpException(
          {
            statusCode: HttpStatus.PAYMENT_REQUIRED,
            error: 'Feature no disponible en tu plan',
            message: 'Esta tienda no ofrece suscripciones.',
            feature: 'subscriptions',
          },
          HttpStatus.PAYMENT_REQUIRED,
        );
      }
      await this.assertSubscribable(tenantId, dto);
    }

    // 1. Precio autoritativo — valida variantes, stock, descuento, envío.
    // Un invitado se valida como "sin cliente": su customerId sale de un correo
    // escrito sin verificar, así que un cupón de un solo uso no puede quedar
    // atado a él (con un correo nuevo por pedido se reutilizaba sin límite).
    const discountCustomerId = opts.guest ? undefined : customerId;
    const priced = await this.cart.price(
      tenantId,
      {
        items: dto.items,
        mode: dto.mode,
        discountCode: dto.discountCode,
      },
      discountCustomerId,
    );

    if (priced.hasStockIssues) {
      const outOfStock = priced.lines
        .filter((l) => l.outOfStock)
        .map((l) => l.productName)
        .join(', ');
      throw new BadRequestException(`Stock insuficiente: ${outOfStock}`);
    }

    // Ninguna compra puede pasar en $0 (el cálculo ya descarta un cupón que la
    // deje así; esto es la última barrera).
    if (priced.totalCents <= 0) {
      throw new BadRequestException(
        'El total del pedido debe ser mayor a $0. Revisa el cupón aplicado.',
      );
    }

    // 2. Crear la orden en estado PENDING dentro de una transacción.
    const order = await this.prisma.$transaction(async (tx) => {
      // Limpiar del carrito persistente los items que se están comprando.
      // En un pedido de invitado no: ese carrito es del dueño de la cuenta.
      if (!opts.guest) {
        await tx.cartItem.deleteMany({
          where: {
            tenantId,
            customerId,
            variantId: { in: priced.lines.map((l) => l.variantId) },
          },
        });
      }

      // El cupón se valida otra vez dentro de la transacción, con su fila
      // bloqueada: dos checkouts simultáneos con el mismo cupón ya no pueden
      // pasar los dos el tope de usos o el "un uso por cliente".
      if (priced.discount?.valid) {
        await this.reserveDiscount(
          tx,
          tenantId,
          priced.discount.code,
          discountCustomerId,
        );
      }

      const subscriptionIds = isSubscription
        ? await this.upsertPendingSubscriptions(tx, tenantId, customerId, dto)
        : [];

      const created = await tx.order.create({
        data: {
          tenantId,
          customerId,
          source: 'CHECKOUT',
          // Enlaza el primer pedido con su suscripción (la primera, si hay
          // varias líneas): al pagarse, la liquidación las activa.
          subscriptionId: subscriptionIds[0],
          status: 'RECEIVED',
          paymentStatus: 'PENDING',
          shippingAddress:
            dto.shippingAddress as unknown as Prisma.InputJsonValue,
          subtotalCents: priced.subtotalCents,
          discountCents: priced.discountCents,
          shippingCents: priced.shippingCents,
          totalCents: priced.totalCents,
          discountCode: priced.discount?.valid
            ? priced.discount.code
            : undefined,
          items: {
            create: priced.lines.map((line) => ({
              tenantId,
              variantId: line.variantId,
              productName: line.productName,
              variantName: variantLabel(line),
              grind: line.grind,
              sizeGrams: line.sizeGrams,
              unitCents: line.unitCents,
              quantity: line.quantity,
              lineCents: line.lineCents,
            })),
          },
        },
      });
      return { ...created, subscriptionIds };
    });

    const summary = {
      subtotalCents: priced.subtotalCents,
      discountCents: priced.discountCents,
      shippingCents: priced.shippingCents,
      discount: priced.discount,
      // Suscripciones creadas con este pedido (esperan su pago para activarse).
      subscriptionIds: order.subscriptionIds,
    };

    // 3a. Tienda sin pagos en línea: el pedido queda recibido y pendiente de
    // pago. Se cobra por fuera (transferencia / contra entrega) y el operador
    // lo marca como pagado en el panel, lo que descuenta el inventario.
    // También es manual si la tienda no usa MercadoPago y Stripe no está
    // habilitado: Stripe cobra en la cuenta de la plataforma, no en la suya.
    const { onlinePayments } = await this.features.get(tenantId);
    // Una suscripción se cobra envío a envío como un pedido normal: con o sin
    // pasarela, su activación llega por la liquidación del pago (webhook u
    // operador), no por este método.
    const stripeAllowed =
      this.config.get<boolean>('stripe.checkoutEnabled') === true;
    // MercadoPago elegido pero sin cuenta conectada tampoco puede cobrar: el
    // pedido queda manual (igual que el front, que apaga el cobro en línea),
    // en vez de marcarse FAILED y bloquear a la tienda recién creada.
    const noGateway =
      tenant.paymentProvider === 'MERCADOPAGO'
        ? !tenant.mpConnected
        : tenant.paymentProvider === 'EPAYCO'
          ? !tenant.epaycoConnected
          : !stripeAllowed;
    if (!onlinePayments || noGateway) {
      return {
        orderId: order.id,
        provider: 'MANUAL' as const,
        paymentStatus: 'PENDING' as const,
        totalCents: order.totalCents,
        summary,
      };
    }

    // 3b. Cobro según el proveedor configurado en la tienda.
    // MercadoPago: Checkout Pro. Se crea la preferencia y el comprador paga en
    // la página de MercadoPago; el pedido queda pendiente hasta que el webhook
    // (o la confirmación, al volver) traiga el pago aprobado.
    if (tenant.paymentProvider === 'MERCADOPAGO') {
      try {
        const pref = await this.mercadopago.createPreference(order.id, {
          returnOrigin: dto.returnOrigin,
        });
        return {
          orderId: order.id,
          provider: 'MERCADOPAGO' as const,
          paymentStatus: 'PENDING' as const,
          checkoutUrl: pref.checkoutUrl,
          preferenceId: pref.preferenceId,
          totalCents: order.totalCents,
          summary,
        };
      } catch (err) {
        this.logger.error(
          `Fallo al crear la preferencia de MercadoPago para orden ${order.id}`,
          err,
        );
        await this.markOrderFailed(
          order.id,
          'Fallo al crear la preferencia de MercadoPago',
        );
        if (err instanceof HttpException) throw err;
        throw new BadGatewayException(
          'No se pudo iniciar el pago con MercadoPago. Intenta nuevamente.',
        );
      }
    }

    // ePayco: Checkout v2. Se crea la sesión con las llaves de la tienda y el
    // front abre la pasarela con `checkout-v2.js`; el pedido queda pendiente
    // hasta la confirmación (aviso de ePayco o sync al volver).
    if (tenant.paymentProvider === 'EPAYCO') {
      try {
        const session = await this.epayco.createSession(order.id, {
          returnOrigin: dto.returnOrigin,
          payerDocument: dto.payerDocument,
        });
        return {
          orderId: order.id,
          provider: 'EPAYCO' as const,
          paymentStatus: 'PENDING' as const,
          epaycoSessionId: session.sessionId,
          epaycoTest: session.test,
          totalCents: order.totalCents,
          summary,
        };
      } catch (err) {
        this.logger.error(
          `Fallo al crear la sesión de ePayco para orden ${order.id}`,
          err,
        );
        await this.markOrderFailed(
          order.id,
          'Fallo al crear la sesión de ePayco',
        );
        if (err instanceof HttpException) throw err;
        throw new BadGatewayException(
          'No se pudo iniciar el pago con ePayco. Intenta nuevamente.',
        );
      }
    }

    // Stripe (proveedor por defecto).
    try {
      const { clientSecret, piId } = await this.stripe.createPaymentIntent(
        order.totalCents,
        order.id,
        tenantId,
      );
      await this.prisma.order.update({
        where: { id: order.id },
        data: { stripePaymentIntentId: piId },
      });
      return {
        orderId: order.id,
        provider: 'STRIPE' as const,
        clientSecret,
        totalCents: order.totalCents,
        summary,
      };
    } catch (err) {
      const isProd = this.config.get<string>('nodeEnv') === 'production';
      if (isProd) {
        this.logger.error(
          `Fallo al crear PaymentIntent de Stripe para orden ${order.id}`,
          err,
        );
        // La orden ya fue creada en PENDING; sin un PaymentIntent asociado
        // quedaría huérfana sin posibilidad de cobro. La marcamos FAILED de
        // inmediato para que no se confunda con una orden en curso.
        await this.markOrderFailed(
          order.id,
          'Fallo al crear el PaymentIntent de Stripe',
        );
        if (err instanceof HttpException) throw err;
        throw new BadGatewayException(
          'No se pudo inicializar el pago con Stripe. Intenta nuevamente.',
        );
      }

      // En desarrollo/test local sin credenciales activas de Stripe,
      // la orden ya fue persistida en Postgres y devolvemos su ID real.
      return {
        orderId: order.id,
        provider: 'STRIPE' as const,
        clientSecret: null,
        totalCents: order.totalCents,
        summary,
      };
    }
  }

  /**
   * Cada línea de un pedido por suscripción debe ser un café suscribible, de
   * una unidad (la suscripción envía una bolsa por ciclo: el esquema no guarda
   * cantidad) y sin variantes repetidas.
   */
  private async assertSubscribable(tenantId: string, dto: CreateOrderDto) {
    const ids = dto.items.map((i) => i.variantId);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException(
        'Cada café puede aparecer una sola vez en un pedido por suscripción',
      );
    }
    if (dto.items.some((i) => i.quantity !== 1)) {
      throw new BadRequestException(
        'Cada suscripción envía una unidad por ciclo: deja la cantidad en 1',
      );
    }
    const variants = await this.prisma.productVariant.findMany({
      where: { tenantId, id: { in: ids } },
      select: {
        id: true,
        product: {
          select: {
            name: true,
            type: true,
            status: true,
            subscriptionAvailability: true,
          },
        },
      },
    });
    for (const v of variants) {
      if (
        v.product.status !== ProductStatus.ACTIVE ||
        v.product.type === 'ACCESSORY' ||
        v.product.subscriptionAvailability === SubAvail.NO
      ) {
        throw new BadRequestException(
          `"${v.product.name}" no está disponible por suscripción`,
        );
      }
    }
    // Las variantes que no existan las rechaza la cotización con su mensaje.
  }

  /**
   * Crea (o reutiliza) la suscripción de cada línea, en la transacción del
   * pedido. Nacen esperando el pago del primer pedido (ver
   * subscription-first-order.ts).
   *
   * Regla "una suscripción por cliente y variante" (el índice único parcial
   * solo cubre ACTIVE; aquí se extiende a todas las no canceladas):
   *  - si ya hay una esperando su primer pago (pedido anterior sin pagar o con
   *    pago rechazado), se reutiliza con la frecuencia y dirección nuevas;
   *  - si ya hay una activa, pausada o con envíos, se rechaza con 409: se
   *    administra desde la cuenta, no se duplica.
   */
  private async upsertPendingSubscriptions(
    tx: Prisma.TransactionClient,
    tenantId: string,
    customerId: string,
    dto: CreateOrderDto,
  ): Promise<string[]> {
    const variantIds = dto.items.map((i) => i.variantId);
    const existing = await tx.subscription.findMany({
      where: {
        tenantId,
        customerId,
        variantId: { in: variantIds },
        status: { not: SubStatus.CANCELLED },
      },
      select: {
        id: true,
        variantId: true,
        status: true,
        lastShippedAt: true,
        variant: { select: { product: { select: { name: true } } } },
      },
    });
    const live = existing.find((s) => !isAwaitingFirstPayment(s));
    if (live) {
      throw new ConflictException(
        `Ya tienes una suscripción a "${live.variant.product.name}". Adminístrala desde Mi cuenta → Suscripciones.`,
      );
    }

    const shippingAddress =
      dto.shippingAddress as unknown as Prisma.InputJsonValue;
    const ids: string[] = [];
    for (const item of dto.items) {
      const frequencyDays =
        item.frequencyDays ??
        dto.frequencyDays ??
        DEFAULT_SUBSCRIPTION_FREQUENCY_DAYS;
      // Provisional: la fecha real se fija al activarse (pago + frecuencia).
      const nextShipAt = new Date(Date.now() + frequencyDays * DAY_MS);
      const pending = existing.find((s) => s.variantId === item.variantId);
      if (pending) {
        await tx.subscription.update({
          where: { id: pending.id },
          data: { frequencyDays, nextShipAt, shippingAddress },
        });
        ids.push(pending.id);
      } else {
        const sub = await tx.subscription.create({
          data: {
            tenantId,
            customerId,
            variantId: item.variantId,
            frequencyDays,
            nextShipAt,
            shippingAddress,
            ...AWAITING_FIRST_PAYMENT,
          },
          select: { id: true },
        });
        ids.push(sub.id);
      }
    }
    return ids;
  }

  /**
   * Reserva el uso de un cupón dentro de la transacción del pedido. Bloquea la
   * fila del cupón (FOR UPDATE), así los checkouts simultáneos con el mismo
   * código se ordenan y cada uno ve los pedidos ya creados por el anterior.
   * Repite los límites de CartService.validateDiscount con datos frescos.
   */
  private async reserveDiscount(
    tx: Prisma.TransactionClient,
    tenantId: string,
    code: string,
    customerId?: string,
  ): Promise<void> {
    const rows = await tx.$queryRaw<
      Array<{
        maxRedemptions: number | null;
        timesRedeemed: number;
        oneUsePerCustomer: boolean;
        active: boolean;
      }>
    >`SELECT "maxRedemptions", "timesRedeemed", "oneUsePerCustomer", "active"
      FROM "DiscountCode"
      WHERE "tenantId" = ${tenantId} AND "code" = ${code}
      FOR UPDATE`;
    const dc = rows[0];
    if (!dc || !dc.active) {
      throw new BadRequestException('El cupón ya no está disponible');
    }
    if (dc.maxRedemptions) {
      const pending = await tx.order.count({
        where: {
          tenantId,
          discountCode: code,
          paymentStatus: 'PENDING',
          status: { not: 'CANCELLED' },
        },
      });
      if (dc.timesRedeemed + pending >= dc.maxRedemptions) {
        throw new BadRequestException(
          'El cupón se agotó mientras confirmabas tu pedido',
        );
      }
    }
    if (dc.oneUsePerCustomer) {
      if (!customerId) {
        throw new BadRequestException(
          'Inicia sesión para usar este cupón de un solo uso',
        );
      }
      const previous = await tx.order.findFirst({
        where: {
          tenantId,
          customerId,
          discountCode: code,
          paymentStatus: { in: ['PAID', 'PENDING'] },
          status: { not: 'CANCELLED' },
        },
        select: { id: true },
      });
      if (previous) {
        throw new BadRequestException(
          'Ya has utilizado este código de descuento',
        );
      }
    }
  }

  /**
   * Marca una orden PENDING como FAILED cuando la creación del pago falla
   * tras haberla persistido, evitando dejarla huérfana sin resolución.
   * No propaga errores: es una compensación best-effort, el error original
   * ya se loguea y se lanza en el caller.
   */
  private async markOrderFailed(
    orderId: string,
    reason: string,
  ): Promise<void> {
    try {
      await this.prisma.order.update({
        where: { id: orderId },
        data: { paymentStatus: 'FAILED' },
      });
    } catch (err) {
      this.logger.error(
        `No se pudo marcar como FAILED la orden huérfana ${orderId} (motivo original: ${reason})`,
        err,
      );
    }
  }
}
