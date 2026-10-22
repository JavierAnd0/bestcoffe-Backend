import { inngest } from './inngest.client';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';

/**
 * Función Inngest para enviar el correo de confirmación de compra cuando una orden queda PAID.
 */
export const createOrderConfirmationFunction = (
  prisma: PrismaService,
  mail: MailService,
) =>
  inngest.createFunction(
    {
      id: 'order-created-confirmation',
      triggers: [{ event: 'order/created' }],
    },
    async ({ event, step }) => {
      const { orderId } = (event as unknown as { data: { orderId: string } })
        .data;

      const order = await step.run('fetch-order-details', async () => {
        return prisma.order.findUnique({
          where: { id: orderId },
          include: {
            customer: { select: { email: true, name: true } },
            tenant: { select: { name: true } },
            items: {
              select: {
                productName: true,
                variantName: true,
                quantity: true,
                lineCents: true,
              },
            },
          },
        });
      });

      if (!order || !order.customer?.email) {
        return { skipped: true, reason: 'Order or customer email not found' };
      }

      await step.run('send-confirmation-email', async () => {
        await mail.sendOrderConfirmation({
          to: order.customer.email,
          customerName: order.customer.name,
          orderId: order.id,
          storeName: order.tenant.name,
          totalCents: order.totalCents,
          items: order.items,
        });
      });

      return { sent: true, orderId: order.id };
    },
  );
