import { inngest } from './inngest.client';
import { SubscriptionRenewalService } from '../subscriptions/subscription-renewal.service';

/**
 * Función Inngest para ejecutar periódicamente la renovación de suscripciones.
 * Se puede disparar por cron diario o por evento manual 'subscriptions/renew'.
 */
export const createRenewSubscriptionsFunction = (
  renewalService: SubscriptionRenewalService,
) =>
  inngest.createFunction(
    {
      id: 'renew-due-subscriptions',
      triggers: [
        { cron: '0 6 * * *' }, // Todos los días a las 06:00 UTC
        { event: 'subscriptions/renew' },
      ],
    },
    async ({ step }) => {
      const result = await step.run('process-due-subscriptions', async () => {
        return renewalService.processDueSubscriptions();
      });

      return result;
    },
  );
