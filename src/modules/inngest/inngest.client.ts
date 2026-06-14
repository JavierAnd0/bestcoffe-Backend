import { Inngest } from 'inngest';

export const inngest = new Inngest({ id: 'bestcoffee-api' });

/**
 * Se dispara cuando una orden queda PAID (webhook payment_intent.succeeded).
 * Punto de extensión: enviar email de confirmación cuando Resend esté listo.
 */
// inngest v4: el trigger va dentro de options como { trigger: { event } }.
const orderCreated = inngest.createFunction(
  { id: 'order-created', triggers: [{ event: 'order/created' }] },
  async ({ event }) => {
    const data = (event as unknown as { data: { orderId: string } }).data;
    console.log('[Inngest] order/created', data.orderId);
    // TODO: enviar email de confirmación cuando Resend esté configurado.
  },
);

export const inngestFunctions = [orderCreated];
