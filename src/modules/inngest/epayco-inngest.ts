import { inngest } from './inngest.client';
import type { EpaycoService } from '../epayco/epayco.service';

/**
 * Revisa cada 15 minutos los pedidos de ePayco que siguen pendientes (PSE,
 * efectivo…) por si el aviso de ePayco no llegó. También se puede disparar a
 * mano con el evento 'epayco/reconcile'.
 */
export const createReconcileEpaycoFunction = (epayco: EpaycoService) =>
  inngest.createFunction(
    {
      id: 'reconcile-epayco-pending',
      triggers: [{ cron: '*/15 * * * *' }, { event: 'epayco/reconcile' }],
    },
    async ({ step }) =>
      step.run('reconcile-pending-orders', () => epayco.reconcilePending()),
  );
