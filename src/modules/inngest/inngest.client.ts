import { Inngest } from 'inngest';

/**
 * Cliente Inngest de la plataforma. Las funciones (jobs recurrentes de
 * suscripciones, webhooks Stripe → Order, etc.) se registran en Fase 4 y se
 * agregan al array `functions`.
 */
export const inngest = new Inngest({ id: 'bestcoffee-api' });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const inngestFunctions: any[] = [];
