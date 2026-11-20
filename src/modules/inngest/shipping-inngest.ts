import { inngest } from './inngest.client';
import type { ShippingService } from '../shipping/shipping.service';

/**
 * Respaldo del webhook de Envia: cada 30 minutos consulta las guías abiertas
 * que llevan un rato sin noticias y mueve el estado de sus pedidos. También
 * se puede disparar a mano con el evento 'shipping/refresh'.
 */
export const createRefreshShipmentsFunction = (shipping: ShippingService) =>
  inngest.createFunction(
    {
      id: 'refresh-open-shipments',
      triggers: [{ cron: '*/30 * * * *' }, { event: 'shipping/refresh' }],
    },
    async ({ step }) =>
      step.run('refresh-open-shipments', () => shipping.refreshOpenShipments()),
  );
