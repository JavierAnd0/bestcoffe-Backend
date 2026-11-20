import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { isSealed } from '../../common/crypto/secret-box';
import { EnviaAccountService } from './envia-account.service';
import { EnviaApiError, EnviaClient } from './envia.client';
import type { SaveEnviaConnectionDto } from './dto/shipping.dto';

type CallArg = {
  data: Record<string, unknown>;
  where?: Record<string, unknown>;
};
/** Primer argumento de la llamada `i` de un mock, con el tipo esperado. */
const argOf = <T = CallArg>(m: jest.Mock, i = 0): T =>
  (m.mock.calls as unknown[][])[i][0] as T;

const dto = (
  over: Partial<SaveEnviaConnectionDto> = {},
): SaveEnviaConnectionDto => ({
  token: 'tok_'.padEnd(40, 'x'),
  test: true,
  origin: {
    name: 'Tostadores',
    phone: '3001234567',
    street: 'Calle 10 # 5-20',
    city: 'Medellín',
    state: 'Antioquia',
  },
  package: { lengthCm: 20, widthCm: 15, heightCm: 10, packagingGrams: 150 },
  ...over,
});

describe('EnviaAccountService', () => {
  let prisma: {
    tenant: {
      findUniqueOrThrow: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
  };
  let client: {
    carriers: jest.Mock;
    states: jest.Mock;
    locate: jest.Mock;
    createTrackingWebhook: jest.Mock;
    deactivateWebhook: jest.Mock;
  };
  let factory: jest.Mock;
  let apiPublicUrl: string;
  let service: EnviaAccountService;

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret';
    apiPublicUrl = 'https://api.bestcoffee.test';
    prisma = {
      tenant: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          enviaToken: null,
          enviaTest: true,
          enviaWebhookId: null,
          enviaConnected: true,
          enviaOrigin: null,
          enviaPackage: null,
          enviaWebhookSecret: null,
        }),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    client = {
      carriers: jest.fn().mockResolvedValue(['coordinadora']),
      states: jest.fn().mockResolvedValue([
        { name: 'Antioquia', code: 'AN' },
        { name: 'Cundinamarca', code: 'CN' },
      ]),
      locate: jest
        .fn()
        .mockResolvedValue({ city: '05001000', name: 'MEDELLIN', state: 'AN' }),
      createTrackingWebhook: jest.fn().mockResolvedValue(77),
      deactivateWebhook: jest.fn().mockResolvedValue(undefined),
    };
    factory = jest.fn().mockReturnValue(client);
    service = new EnviaAccountService(
      prisma as unknown as PrismaService,
      { get: () => apiPublicUrl } as unknown as ConfigService,
      factory,
    );
  });

  it('prueba el token, valida el origen, cifra el token y registra el webhook', async () => {
    await service.save('t1', dto());

    expect(factory).toHaveBeenCalledWith(dto().token, true);
    expect(client.locate).toHaveBeenCalledWith('Medellín', 'AN');
    expect(client.createTrackingWebhook).toHaveBeenCalledWith(
      'https://api.bestcoffee.test/v1/shipping/envia/webhook/t1',
    );
    const data = argOf(prisma.tenant.update).data;
    expect(isSealed(data.enviaToken as string)).toBe(true);
    expect(data.enviaToken).not.toContain('tok_');
    expect(data).toMatchObject({
      enviaConnected: true,
      enviaTest: true,
      enviaWebhookId: 77,
      enviaOrigin: expect.objectContaining({
        cityCode: '05001000',
        stateCode: 'AN',
      }) as unknown,
    });
  });

  it('un token rechazado no se guarda', async () => {
    client.carriers.mockRejectedValue(
      new EnviaApiError('Authentication error.', 401),
    );
    await expect(service.save('t1', dto())).rejects.toMatchObject({
      status: 400,
    });
    expect(prisma.tenant.update).not.toHaveBeenCalled();
  });

  it('un origen que Envia no reconoce no se guarda', async () => {
    client.locate.mockResolvedValue(null);
    await expect(service.save('t1', dto())).rejects.toMatchObject({
      status: 400,
    });
    expect(prisma.tenant.update).not.toHaveBeenCalled();
  });

  it('sin API_PUBLIC_URL conecta igual, sin webhook (queda el job)', async () => {
    apiPublicUrl = '';
    await service.save('t1', dto());
    expect(client.createTrackingWebhook).not.toHaveBeenCalled();
    expect(argOf(prisma.tenant.update).data.enviaWebhookId).toBeNull();
  });

  it('Bogotá prueba DC y CN si el departamento no coincide', async () => {
    client.locate.mockImplementation((_city: string, state: string) =>
      Promise.resolve(
        state === 'CN'
          ? { city: '11001000', name: 'BOGOTA', state: 'CN' }
          : null,
      ),
    );
    const place = await service.resolvePlace(
      client as unknown as EnviaClient,
      true,
      'Bogotá',
      'Bogotá D.C.',
    );
    expect(place).toEqual({ cityCode: '11001000', stateCode: 'CN' });
  });

  it('el secreto del webhook es el que pegó la tienda o, si no hay, el token', async () => {
    await service.save('t1', dto({ webhookSecret: 'whsec' }));
    const saved = argOf(prisma.tenant.update).data;
    prisma.tenant.findUnique.mockResolvedValue({
      enviaConnected: true,
      enviaToken: saved.enviaToken,
      enviaWebhookSecret: saved.enviaWebhookSecret,
    });
    expect(await service.webhookSecret('t1')).toBe('whsec');

    prisma.tenant.findUnique.mockResolvedValue({
      enviaConnected: true,
      enviaToken: saved.enviaToken,
      enviaWebhookSecret: null,
    });
    expect(await service.webhookSecret('t1')).toBe(dto().token);
  });
});

describe('EnviaClient', () => {
  const fakeFetch = (status: number, body: unknown) =>
    jest.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      text: () =>
        Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
    });

  it('usa el sandbox y el token Bearer de la tienda', async () => {
    const f = fakeFetch(200, {
      data: [
        { name: 'coordinadora', active: true },
        { name: 'tcc', active: false },
      ],
    });
    const c = new EnviaClient('tok', true, f);
    expect(await c.carriers()).toEqual(['coordinadora']);
    const [url, init] = f.mock.calls[0] as [
      string,
      { headers: Record<string, string> },
    ];
    expect(url).toBe('https://queries.test.envia.com/carrier?country_code=CO');
    expect(init.headers.Authorization).toBe('Bearer tok');
  });

  it('lee la guía generada', async () => {
    const f = fakeFetch(200, {
      meta: 'generate',
      data: [
        {
          carrier: 'coordinadora',
          service: 'ground',
          shipmentId: 123,
          trackingNumber: '999',
          trackUrl: 'https://t',
          label: 'https://l.pdf',
          totalPrice: 15000,
          currency: 'COP',
        },
      ],
    });
    const c = new EnviaClient('tok', false, f);
    const label = await c.generate({
      origin: {} as never,
      destination: {} as never,
      packages: [],
      carrier: 'coordinadora',
      service: 'ground',
      orderReference: 'o1',
      printSize: 'PAPER_4X6',
    });
    expect(argOf<string>(f)).toBe('https://api.envia.com/ship/generate/');
    expect(label).toMatchObject({
      shipmentId: '123',
      trackingNumber: '999',
      label: 'https://l.pdf',
    });
  });

  it('convierte los errores de Envia en EnviaApiError', async () => {
    const c = new EnviaClient(
      'tok',
      true,
      fakeFetch(401, 'Authentication error.'),
    );
    await expect(c.carriers()).rejects.toMatchObject({
      status: 401,
      message: 'Authentication error.',
    });

    const c2 = new EnviaClient(
      'tok',
      true,
      fakeFetch(200, {
        meta: 'error',
        error: { code: 1149, message: 'Address cannot be validated.' },
      }),
    );
    await expect(
      c2.rate({
        origin: {} as never,
        destination: {} as never,
        packages: [],
        carrier: 'x',
      }),
    ).rejects.toMatchObject({
      status: 422,
      message: 'Address cannot be validated.',
    });
  });

  it('locate devuelve null si Envia no valida la ciudad', async () => {
    const c = new EnviaClient(
      'tok',
      true,
      fakeFetch(422, {
        meta: 'error',
        error: { message: 'Address cannot be validated.' },
      }),
    );
    expect(await c.locate('Narnia', 'AN')).toBeNull();
  });

  it('lee el seguimiento con nombres de campo alternativos', async () => {
    const c = new EnviaClient(
      'tok',
      true,
      fakeFetch(200, {
        data: [
          {
            trackingNumber: 'A',
            status: 'Delivered',
            eventHistory: [
              {
                date: '2026-11-18T10:00:00Z',
                location: 'Cali',
                description: 'Entregado',
              },
            ],
          },
          { tracking_number: 'B', statusId: 2 },
          { foo: 'sin guía' },
        ],
      }),
    );
    const rows = await c.track(['A', 'B']);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      trackingNumber: 'A',
      status: 'Delivered',
      location: 'Cali',
      description: 'Entregado',
    });
    expect(rows[1]).toMatchObject({ trackingNumber: 'B', status: 2 });
  });
});
