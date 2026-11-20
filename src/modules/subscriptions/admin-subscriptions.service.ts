import {
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService, type SubscriptionChange } from '../mail/mail.service';
import { SubscriptionLifecycleService } from './subscription-lifecycle.service';
import { ListSubscriptionsDto } from './dto/list-subscriptions.dto';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';

const SUB_DETAIL_SELECT = {
  id: true,
  tenantId: true,
  customerId: true,
  variantId: true,
  frequencyDays: true,
  status: true,
  lastShippedAt: true,
  nextShipAt: true,
  discountPct: true,
  shippingAddress: true,
  stripeSubscriptionId: true,
  createdAt: true,
  updatedAt: true,
  customer: { select: { id: true, email: true, name: true } },
  variant: {
    select: {
      id: true,
      sizeGrams: true,
      grind: true,
      product: { select: { slug: true, name: true } },
    },
  },
} satisfies Prisma.SubscriptionSelect;

type SubDetail = Prisma.SubscriptionGetPayload<{
  select: typeof SUB_DETAIL_SELECT;
}>;

@Injectable()
export class AdminSubscriptionsService {
  private readonly logger = new Logger(AdminSubscriptionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: SubscriptionLifecycleService,
    @Optional() private readonly mail?: MailService,
  ) {}

  /** Listado admin con filtros y paginación keyset por nextShipAt/id. */
  async list(tenantId: string, dto: ListSubscriptionsDto) {
    const limit = dto.limit ?? 25;
    const items = await this.prisma.subscription.findMany({
      where: {
        tenantId,
        ...(dto.status && { status: dto.status }),
        ...(dto.customerId && { customerId: dto.customerId }),
      },
      take: limit + 1,
      ...(dto.cursor && { cursor: { id: dto.cursor }, skip: 1 }),
      orderBy: { nextShipAt: 'asc' },
      select: {
        id: true,
        status: true,
        frequencyDays: true,
        discountPct: true,
        nextShipAt: true,
        lastShippedAt: true,
        createdAt: true,
        customer: { select: { id: true, email: true, name: true } },
        variant: {
          select: {
            sizeGrams: true,
            grind: true,
            priceSubscription: true,
            priceOneTime: true,
            product: { select: { slug: true, name: true } },
          },
        },
      },
    });
    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;
    return {
      items: page,
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  async findOne(tenantId: string, id: string) {
    const sub = await this.prisma.subscription.findFirst({
      where: { id, tenantId },
      select: SUB_DETAIL_SELECT,
    });
    if (!sub) throw new NotFoundException('Suscripción no encontrada');
    return sub;
  }

  /** Pausa una suscripción activa (o en SKIPPED_NEXT / PAYMENT_FAILED). */
  async pause(tenantId: string, id: string) {
    const sub = await this.lifecycle.pause({ id, tenantId }, SUB_DETAIL_SELECT);
    this.notifyCustomer(sub, 'paused');
    return sub;
  }

  /**
   * Reanuda una suscripción pausada. Si la próxima fecha quedó en el pasado,
   * la reprograma a hoy + frecuencia para no disparar un envío inmediato.
   */
  async resume(tenantId: string, id: string) {
    const sub = await this.lifecycle.resume(
      { id, tenantId },
      SUB_DETAIL_SELECT,
    );
    this.notifyCustomer(sub, 'resumed');
    return sub;
  }

  /** Salta el próximo envío: empuja nextShipAt una frecuencia hacia adelante. */
  async skipNext(tenantId: string, id: string) {
    const sub = await this.lifecycle.skipNext(
      { id, tenantId },
      SUB_DETAIL_SELECT,
    );
    this.notifyCustomer(sub, 'skipped');
    return sub;
  }

  /** Cancela la suscripción (terminal). */
  async cancel(tenantId: string, id: string) {
    const sub = await this.lifecycle.cancel(
      { id, tenantId },
      SUB_DETAIL_SELECT,
    );
    this.notifyCustomer(sub, 'cancelled');
    return sub;
  }

  /** Edita frecuencia y/o descuento sin tocar el estado. */
  async update(tenantId: string, id: string, dto: UpdateSubscriptionDto) {
    const before =
      dto.frequencyDays !== undefined
        ? await this.prisma.subscription.findFirst({
            where: { id, tenantId },
            select: { frequencyDays: true },
          })
        : null;
    const sub = await this.lifecycle.updateTerms(
      { id, tenantId },
      { frequencyDays: dto.frequencyDays, discountPct: dto.discountPct },
      SUB_DETAIL_SELECT,
    );
    // Solo se avisa si la frecuencia cambió de verdad; el descuento es interno.
    if (before && before.frequencyDays !== sub.frequencyDays) {
      this.notifyCustomer(sub, 'frequency');
    }
    return sub;
  }

  /**
   * Avisa por correo al cliente de un cambio hecho desde el panel. No bloquea
   * la respuesta ni la hace fallar si el correo no sale.
   */
  private notifyCustomer(sub: SubDetail, change: SubscriptionChange): void {
    if (!this.mail || !sub.customer?.email) return;
    const mail = this.mail;
    const to = sub.customer.email;
    void mail
      .sendSubscriptionChanged({
        to,
        customerName: sub.customer.name,
        tenantId: sub.tenantId,
        productName: sub.variant.product.name,
        change,
        frequencyDays: sub.frequencyDays,
        nextShipAt: sub.nextShipAt,
      })
      .catch((err: unknown) =>
        this.logger.warn(
          `No se pudo avisar al cliente del cambio (${change}) en la suscripción ${sub.id}: ${String(err)}`,
        ),
      );
  }
}
