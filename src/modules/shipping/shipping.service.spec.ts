import { createHmac } from 'node:crypto';
import type { Shipment } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import {
  EnviaAccountService,
  type EnviaAccount,
} from './envia-account.service';
import { EnviaClient } from './envia.client';
import { ShippingService } from './shipping.service';

type CallArg = {
  data: Record<string, unknown>;
  where?: Record<string, unknown>;
};
type RateCall = {
  destination: Record<string, unknown>;
  origin: Record<string, unknown>;
  packages: { declaredValue: number }[];
};
/** Primer argumento de la llamada `i` de un mock, con el tipo esperado. */
const argOf = <T = CallArg>(m: jest.Mock, i = 0): T =>
  (m.mock.calls as unknown[][])[i][0] as T;

const ORIGIN = {
  name: 'Tostadores',
  phone: '3001234567',
  street: 'Calle 10 # 5-20',
  city: 'Medellín',
  state: 'Antioquia',
  cityCode: '05001000',
  stateCode: 'AN',
};

const shipmentRow = (over: Partial<Shipment> = {}): Shipment => ({
  id: 's1',
  tenantId: 't1',
  orderId: 'o1',
  provider: 'ENVIA',
  carrier: 'coordinadora',
  service: 'ground',
  trackingNumber: 'TRK1',
  providerShipmentId: '99',
  labelUrl: 'https://envia/label.pdf',
  trackingUrl: 'https://envia/track/TRK1',
  costCents: 1_250_000,
  currency: 'COP',
  status: 'LABEL_CREATED',
  providerStatus: 'created',
  statusDetail: null,
  lastEventAt: null,
  lastCheckedAt: null,
  deliveredAt: null,
  cancelledAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

const paidOrder = (over: Record<string, unknown> = {}) => ({
  id: 'o1',
  tenantId: 't1',
  status: 'RECEIVED',
  paymentStatus: 'PAID',
  subtotalCents: 9_000_000,
  shippingAddress: {
    recipientName: 'Ana Pérez',
    line1: 'Cra 7 # 12-34',
    line2: 'Apto 301',
    city: 'Bogotá',
    state: 'Bogotá D.C.',
    phone: '+57 310 555 1234',
  },
  items: [{ sizeGrams: 500, quantity: 2 }],
  customer: { name: 'Ana', email: 'ana@example.com', phone: null },
  shipments: [],
  ...over,
});

describe('ShippingService', () => {
  let prisma: {
    order: {
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    shipment: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    shippingEvent: { findUnique: jest.Mock; create: jest.Mock };
    $transaction: jest.Mock;
  };
  let client: {
    carriers: jest.Mock;
    rate: jest.Mock;
    generate: jest.Mock;
    cancel: jest.Mock;
    track: jest.Mock;
  };
  let accounts: {
    requireAccount: jest.Mock;
    findAccount: jest.Mock;
    resolvePlace: jest.Mock;
    webhookSecret: jest.Mock;
  };
  let mail: { sendOrderShipped: jest.Mock };
  let service: ShippingService;

  beforeEach(() => {
    prisma = {
      order: {
        findFirst: jest.fn(),
        findUnique: jest.fn().mockResolvedValue({
          id: 'o1',
          trackingUrl: 'https://envia/track/TRK1',
          customer: { email: 'ana@example.com', name: 'Ana' },
          tenant: { name: 'Café Uno' },
        }),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      shipment: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(({ data }: { data: object }) => ({
          id: 's1',
          ...data,
        })),
        update: jest.fn().mockImplementation(({ data }: { data: object }) => ({
          id: 's1',
          ...data,
        })),
      },
      shippingEvent: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(
      (fn: (tx: typeof prisma) => unknown) => fn(prisma),
    );

    client = {
      carriers: jest
        .fn()
        .mockResolvedValue(['coordinadora', 'servientrega', 'tcc']),
      rate: jest.fn(),
      generate: jest.fn().mockResolvedValue({
        carrier: 'coordinadora',
        service: 'ground',
        shipmentId: '99',
        trackingNumber: 'TRK1',
        trackUrl: 'https://envia/track/TRK1',
        label: 'https://envia/label.pdf',
        totalPrice: 12500,
        currency: 'COP',
      }),
      cancel: jest.fn().mockResolvedValue(undefined),
      track: jest.fn().mockResolvedValue([]),
    };
    const account: EnviaAccount = {
      tenantId: 't1',
      client: client as unknown as EnviaClient,
      test: true,
      origin: ORIGIN,
      package: { lengthCm: 20, widthCm: 15, heightCm: 10, packagingGrams: 150 },
    };
    accounts = {
      requireAccount: jest.fn().mockResolvedValue(account),
      findAccount: jest.fn().mockResolvedValue(account),
      resolvePlace: jest
        .fn()
        .mockResolvedValue({ cityCode: '11001000', stateCode: 'DC' }),
      webhookSecret: jest.fn().mockResolvedValue('secreto-tienda'),
    };
    mail = { sendOrderShipped: jest.fn().mockResolvedValue(undefined) };

    service = new ShippingService(
      prisma as unknown as PrismaService,
      accounts as unknown as EnviaAccountService,
      mail as unknown as MailService,
    );
  });

  describe('quote', () => {
    it('cotiza con todas las transportadoras, ordena por precio y tolera una que falle', async () => {
      prisma.order.findFirst.mockResolvedValue(paidOrder());
      client.rate.mockImplementation(({ carrier }: { carrier: string }) => {
        if (carrier === 'tcc')
          return Promise.reject(new Error('sin cobertura'));
        return Promise.resolve([
          {
            carrier,
            service: 'ground',
            serviceDescription: 'Terrestre',
            deliveryEstimate: '2-3 días',
            totalPrice: carrier === 'servientrega' ? 9800 : 12500,
            currency: 'COP',
          },
        ]);
      });

      const res = await service.quote('t1', 'o1', {});

      expect(res.rates.map((r) => r.carrier)).toEqual([
        'servientrega',
        'coordinadora',
      ]);
      expect(res.rates[0].totalCents).toBe(980_000);
      expect(res.package.weightKg).toBe(1.2);
      expect(res.destination).toEqual({
        cityCode: '11001000',
        stateCode: 'DC',
      });
      const sent = argOf<RateCall>(client.rate);
      expect(sent.destination).toMatchObject({
        name: 'Ana Pérez',
        phone: '573105551234',
        city: '11001000',
        state: 'DC',
        postalCode: '11001000',
        reference: 'Apto 301',
      });
      expect(sent.origin).toMatchObject({ city: '05001000', state: 'AN' });
      expect(sent.packages[0].declaredValue).toBe(90_000);
    });

    it('no cotiza un pedido sin pagar', async () => {
      prisma.order.findFirst.mockResolvedValue(
        paidOrder({ paymentStatus: 'PENDING' }),
      );
      await expect(service.quote('t1', 'o1', {})).rejects.toMatchObject({
        status: 400,
      });
      expect(client.carriers).not.toHaveBeenCalled();
    });

    it('pide el código DANE si Envia no reconoce la ciudad', async () => {
      prisma.order.findFirst.mockResolvedValue(paidOrder());
      accounts.resolvePlace.mockResolvedValue(null);
      await expect(service.quote('t1', 'o1', {})).rejects.toMatchObject({
        status: 400,
      });
    });

    it('usa el código DANE que escribe el operador', async () => {
      prisma.order.findFirst.mockResolvedValue(paidOrder());
      client.rate.mockResolvedValue([
        {
          carrier: 'x',
          service: 's',
          serviceDescription: 's',
          deliveryEstimate: null,
          totalPrice: 1,
          currency: 'COP',
        },
      ]);
      await service.quote('t1', 'o1', {
        destinationCityCode: '25754000',
        destinationStateCode: 'CN',
      });
      expect(accounts.resolvePlace).not.toHaveBeenCalled();
      expect(argOf<RateCall>(client.rate).destination.city).toBe('25754000');
    });
  });

  describe('createLabel', () => {
    it('genera la guía, la guarda y pasa el pedido a PREPARING', async () => {
      prisma.order.findFirst.mockResolvedValue(paidOrder());

      await service.createLabel('t1', 'o1', {
        carrier: 'coordinadora',
        service: 'ground',
      });

      expect(client.generate).toHaveBeenCalledWith(
        expect.objectContaining({
          carrier: 'coordinadora',
          service: 'ground',
          orderReference: 'o1',
          printSize: 'PAPER_4X6',
        }),
      );
      expect(prisma.shipment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          trackingNumber: 'TRK1',
          labelUrl: 'https://envia/label.pdf',
          costCents: 1_250_000,
          status: 'LABEL_CREATED',
        }) as unknown,
      });
      expect(prisma.order.update).toHaveBeenCalledWith({
        where: { id: 'o1' },
        data: {
          shippingCarrier: 'coordinadora',
          trackingNumber: 'TRK1',
          trackingUrl: 'https://envia/track/TRK1',
          status: 'PREPARING',
        },
      });
    });

    it('rechaza si el pedido ya tiene una guía activa', async () => {
      prisma.order.findFirst.mockResolvedValue(
        paidOrder({ shipments: [shipmentRow()] }),
      );
      await expect(
        service.createLabel('t1', 'o1', {
          carrier: 'coordinadora',
          service: 'ground',
        }),
      ).rejects.toMatchObject({ status: 409 });
      expect(client.generate).not.toHaveBeenCalled();
    });

    it('si otra guía ganó la carrera, anula en Envia la que sobra', async () => {
      prisma.order.findFirst.mockResolvedValue(paidOrder());
      prisma.shipment.findFirst.mockResolvedValue({ id: 'other' });
      await expect(
        service.createLabel('t1', 'o1', {
          carrier: 'coordinadora',
          service: 'ground',
        }),
      ).rejects.toMatchObject({ status: 409 });
      expect(client.cancel).toHaveBeenCalledWith('coordinadora', 'TRK1');
      expect(prisma.shipment.create).not.toHaveBeenCalled();
    });
  });

  describe('cancelLabel', () => {
    it('anula la guía y libera el pedido', async () => {
      prisma.order.findFirst.mockResolvedValue({ id: 'o1' });
      prisma.shipment.findFirst.mockResolvedValue(shipmentRow());
      await service.cancelLabel('t1', 'o1');
      expect(client.cancel).toHaveBeenCalledWith('coordinadora', 'TRK1');
      expect(prisma.order.updateMany).toHaveBeenCalledWith({
        where: { id: 'o1', trackingNumber: 'TRK1' },
        data: {
          trackingNumber: null,
          shippingCarrier: null,
          trackingUrl: null,
        },
      });
    });

    it('no anula una guía que la transportadora ya recogió', async () => {
      prisma.order.findFirst.mockResolvedValue({ id: 'o1' });
      prisma.shipment.findFirst.mockResolvedValue(
        shipmentRow({ status: 'IN_TRANSIT' }),
      );
      await expect(service.cancelLabel('t1', 'o1')).rejects.toMatchObject({
        status: 400,
      });
      expect(client.cancel).not.toHaveBeenCalled();
    });
  });

  describe('applyTracking', () => {
    it('en camino → pedido SHIPPED y correo al cliente', async () => {
      prisma.order.findFirst.mockResolvedValue({ status: 'PREPARING' });

      const changed = await service.applyTracking(shipmentRow(), {
        status: 'Picked Up',
        location: 'Medellín',
      });

      expect(changed).toBe(true);
      expect(prisma.shipment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'IN_TRANSIT',
            statusDetail: 'Medellín',
          }) as unknown,
        }),
      );
      expect(prisma.order.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'o1',
          trackingNumber: 'TRK1',
          status: { in: ['RECEIVED', 'PREPARING'] },
        },
        data: { status: 'SHIPPED' },
      });
      expect(mail.sendOrderShipped).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'ana@example.com',
          trackingUrl: 'https://envia/track/TRK1',
        }),
      );
    });

    it('entregado → pedido DELIVERED', async () => {
      prisma.order.findFirst.mockResolvedValue({ status: 'SHIPPED' });
      await service.applyTracking(shipmentRow({ status: 'IN_TRANSIT' }), {
        status: 3,
      });
      expect(prisma.order.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'DELIVERED' } }),
      );
      expect(argOf(prisma.shipment.update).data.deliveredAt).toBeInstanceOf(
        Date,
      );
      expect(mail.sendOrderShipped).not.toHaveBeenCalled();
    });

    it('no toca un pedido cancelado', async () => {
      prisma.order.findFirst.mockResolvedValue({ status: 'CANCELLED' });
      await service.applyTracking(shipmentRow(), { status: 'shipped' });
      expect(prisma.order.updateMany).not.toHaveBeenCalled();
      expect(mail.sendOrderShipped).not.toHaveBeenCalled();
    });

    it('si el webhook y el job llegan juntos, solo uno manda el correo', async () => {
      prisma.order.findFirst.mockResolvedValue({ status: 'PREPARING' });
      prisma.order.updateMany.mockResolvedValue({ count: 0 });
      await service.applyTracking(shipmentRow(), { status: 'shipped' });
      expect(mail.sendOrderShipped).not.toHaveBeenCalled();
    });

    it('una guía que no es la activa del pedido no lo mueve', async () => {
      prisma.order.findFirst.mockResolvedValue(null);
      await service.applyTracking(shipmentRow(), { status: 'delivered' });
      expect(prisma.order.updateMany).not.toHaveBeenCalled();
    });

    it('ignora eventos de una guía ya entregada', async () => {
      const changed = await service.applyTracking(
        shipmentRow({ status: 'DELIVERED' }),
        {
          status: 'shipped',
        },
      );
      expect(changed).toBe(false);
      expect(argOf(prisma.shipment.update).data).not.toHaveProperty('status');
    });

    it('no retrocede de "en camino" a "creada"', async () => {
      const changed = await service.applyTracking(
        shipmentRow({ status: 'IN_TRANSIT' }),
        {
          status: 'created',
        },
      );
      expect(changed).toBe(false);
      expect(prisma.order.updateMany).not.toHaveBeenCalled();
    });

    it('novedad → guía EXCEPTION, el pedido sigue igual', async () => {
      await service.applyTracking(shipmentRow({ status: 'IN_TRANSIT' }), {
        status: 'address error',
      });
      expect(argOf(prisma.shipment.update).data.status).toBe('EXCEPTION');
      expect(prisma.order.updateMany).not.toHaveBeenCalled();
    });

    it('anulada en Envia → la guía queda CANCELLED y libera el pedido', async () => {
      await service.applyTracking(shipmentRow(), { status: 'canceled' });
      expect(argOf(prisma.shipment.update).data.status).toBe('CANCELLED');
      expect(prisma.order.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            trackingNumber: null,
            shippingCarrier: null,
            trackingUrl: null,
          },
        }),
      );
    });
  });

  describe('handleWebhook', () => {
    const body = JSON.stringify({
      type: 'tracking.simple',
      data: {
        tracking_number: 'TRK1',
        status: 'delivered',
        location: 'Bogotá',
      },
    });
    const signed = (secret = 'secreto-tienda', ts = String(Date.now())) => ({
      'x-webhook-event': 'tracking.simple',
      'x-webhook-timestamp': ts,
      'x-webhook-id': 'evt-1',
      'x-webhook-signature':
        'v1=' +
        createHmac('sha256', secret)
          .update(`${ts}.tracking.simple.${body}`)
          .digest('hex'),
    });

    it('rechaza una firma inválida sin tocar nada', async () => {
      await expect(
        service.handleWebhook('t1', signed('otro'), body),
      ).rejects.toMatchObject({
        status: 401,
      });
      expect(prisma.shipment.findFirst).not.toHaveBeenCalled();
    });

    it('404 si la tienda no tiene Envia conectado', async () => {
      accounts.webhookSecret.mockResolvedValue(null);
      await expect(
        service.handleWebhook('t1', signed(), body),
      ).rejects.toMatchObject({
        status: 404,
      });
    });

    it('con firma válida consulta a Envia y aplica lo que dice la API', async () => {
      prisma.shipment.findFirst.mockResolvedValue(
        shipmentRow({ status: 'IN_TRANSIT' }),
      );
      prisma.order.findFirst.mockResolvedValue({ status: 'SHIPPED' });
      client.track.mockResolvedValue([
        {
          trackingNumber: 'TRK1',
          status: 'Out for delivery',
          description: 'En reparto',
          location: null,
          eventAt: null,
          trackUrl: null,
        },
      ]);

      const res = await service.handleWebhook('t1', signed(), body);

      expect(res).toEqual({ ok: true, applied: true });
      expect(client.track).toHaveBeenCalledWith(['TRK1']);
      // La API dice "en reparto": sigue en camino, no se marca entregado.
      expect(prisma.order.updateMany).not.toHaveBeenCalled();
      expect(prisma.shippingEvent.create).toHaveBeenCalledWith({
        data: { id: 'evt-1', type: 'tracking.simple' },
      });
    });

    it('si Envia no responde el seguimiento, usa el aviso firmado', async () => {
      prisma.shipment.findFirst.mockResolvedValue(
        shipmentRow({ status: 'IN_TRANSIT' }),
      );
      prisma.order.findFirst.mockResolvedValue({ status: 'SHIPPED' });
      client.track.mockRejectedValue(new Error('timeout'));

      await service.handleWebhook('t1', signed(), body);

      expect(prisma.order.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'DELIVERED' } }),
      );
    });

    it('un reintento con el mismo X-Webhook-Id no se procesa dos veces', async () => {
      prisma.shippingEvent.findUnique.mockResolvedValue({ id: 'evt-1' });
      const res = await service.handleWebhook('t1', signed(), body);
      expect(res).toEqual({ ok: true, duplicate: true });
      expect(prisma.shipment.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('refreshOpenShipments', () => {
    it('consulta las guías abiertas por tienda y aplica los cambios', async () => {
      prisma.shipment.findMany.mockResolvedValue([
        shipmentRow({ id: 's1', trackingNumber: 'A' }),
        shipmentRow({ id: 's2', trackingNumber: 'B' }),
      ]);
      prisma.order.findFirst.mockResolvedValue({ status: 'PREPARING' });
      client.track.mockResolvedValue([
        {
          trackingNumber: 'A',
          status: 'shipped',
          description: null,
          location: null,
          eventAt: null,
          trackUrl: null,
        },
      ]);

      const res = await service.refreshOpenShipments();

      expect(client.track).toHaveBeenCalledTimes(1);
      expect(client.track).toHaveBeenCalledWith(['A', 'B']);
      expect(res).toEqual({ checked: 2, changed: 1 });
      // B no vino en la respuesta: solo se marca como consultada.
      expect(prisma.shipment.update).toHaveBeenCalledWith({
        where: { id: 's2' },
        data: { lastCheckedAt: expect.any(Date) as unknown },
      });
    });
  });
});
