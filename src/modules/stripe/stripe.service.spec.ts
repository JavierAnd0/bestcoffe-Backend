import { ConfigService } from '@nestjs/config';
import { StripeService } from './stripe.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { OrderSettlementService } from '../orders/order-settlement.service';

/**
 * Stripe trata COP como moneda de dos decimales: el `amount` debe ir en
 * centavos (lo mismo que guarda la base). Antes se dividía entre 100 y un
 * pedido de $45.000 se cobraba como $450.
 */
describe('StripeService · montos en COP', () => {
  const create = jest.fn();

  function build(): StripeService {
    const config = new ConfigService({ stripe: { secretKey: 'sk_test_x' } });
    const svc = new StripeService(
      {} as PrismaService,
      config,
      {} as OrderSettlementService,
    );
    // Sustituye el SDK perezoso por un doble con lo que usamos.
    (svc as unknown as { _sdk: unknown })._sdk = {
      paymentIntents: { create },
    };
    return svc;
  }

  beforeEach(() => {
    create.mockReset();
    create.mockResolvedValue({
      id: 'pi_1',
      client_secret: 'cs_1',
      status: 'succeeded',
    });
  });

  it('createPaymentIntent envía los centavos tal cual', async () => {
    await build().createPaymentIntent(4_500_000, 'order_1', 'tenant_1');
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 4_500_000, currency: 'cop' }),
    );
  });

  it('chargeOffSession envía los centavos tal cual', async () => {
    await build().chargeOffSession('cus_1', 2_880_000, 'order_2', 'tenant_1');
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 2_880_000, currency: 'cop' }),
    );
  });
});
