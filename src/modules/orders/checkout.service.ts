import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantFeaturesService } from '../../common/features/tenant-features.service';
import { CartService } from '../cart/cart.service';
import { StripeService } from '../stripe/stripe.service';
import { MercadoPagoService } from '../mercadopago/mercadopago.service';
import type {
  CreateGuestOrderDto,
  CreateOrderDto,
} from './dto/create-order.dto';
import { PurchaseMode } from '../cart/dto/price-cart.dto';

@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cart: CartService,
    private readonly stripe: StripeService,
    private readonly mercadopago: MercadoPagoService,
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
      select: { paymentProvider: true, mpConnected: true },
    });

    // 1. Precio autoritativo — valida variantes, stock, descuento, envío.
    const priced = await this.cart.price(
      tenantId,
      {
        items: dto.items,
        mode: dto.mode,
        discountCode: dto.discountCode,
      },
      customerId,
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

      return tx.order.create({
        data: {
          tenantId,
          customerId,
          source: 'CHECKOUT',
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
              variantName: `${line.sizeGrams}g · ${line.grind}`,
              grind: line.grind,
              sizeGrams: line.sizeGrams,
              unitCents: line.unitCents,
              quantity: line.quantity,
              lineCents: line.lineCents,
            })),
          },
        },
      });
    });

    const summary = {
      subtotalCents: priced.subtotalCents,
      discountCents: priced.discountCents,
      shippingCents: priced.shippingCents,
      discount: priced.discount,
    };

    // 3a. Tienda sin pagos en línea: el pedido queda recibido y pendiente de
    // pago. Se cobra por fuera (transferencia / contra entrega) y el operador
    // lo marca como pagado en el panel, lo que descuenta el inventario.
    // También es manual si la tienda no usa MercadoPago y Stripe no está
    // habilitado: Stripe cobra en la cuenta de la plataforma, no en la suya.
    const { onlinePayments } = await this.features.get(tenantId);
    const stripeAllowed =
      this.config.get<boolean>('stripe.checkoutEnabled') === true;
    // MercadoPago elegido pero sin cuenta conectada tampoco puede cobrar: el
    // pedido queda manual (igual que el front, que apaga el cobro en línea),
    // en vez de marcarse FAILED y bloquear a la tienda recién creada.
    const noGateway =
      tenant.paymentProvider === 'MERCADOPAGO'
        ? !tenant.mpConnected
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
    if (tenant.paymentProvider === 'MERCADOPAGO') {
      if (!tenant.mpConnected) {
        await this.markOrderFailed(
          order.id,
          'La tienda no tiene MercadoPago conectado',
        );
        throw new BadRequestException(
          'La tienda no tiene MercadoPago conectado',
        );
      }
      if (!dto.payment) {
        await this.markOrderFailed(
          order.id,
          'Faltan los datos de pago (tarjeta)',
        );
        throw new BadRequestException('Faltan los datos de pago (tarjeta)');
      }
      try {
        // createPayment persiste mpPaymentId en la orden (vía applyPaymentStatus),
        // de modo que el webhook pueda reconciliar el estado por ese id.
        const result = await this.mercadopago.createPayment(
          order.id,
          dto.payment,
        );
        return {
          orderId: order.id,
          provider: 'MERCADOPAGO' as const,
          paymentStatus: result.status,
          statusDetail: result.statusDetail,
          mpPaymentId: result.mpPaymentId,
          totalCents: order.totalCents,
          summary,
        };
      } catch (err) {
        this.logger.error(
          `Fallo al crear el pago de MercadoPago para orden ${order.id}`,
          err,
        );
        await this.markOrderFailed(
          order.id,
          'Fallo al crear el pago de MercadoPago',
        );
        if (err instanceof HttpException) throw err;
        throw new BadGatewayException(
          'No se pudo procesar el pago con MercadoPago. Intenta nuevamente.',
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
