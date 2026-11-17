import { AppThrottlerGuard } from './app-throttler.guard';
import { signClientIp } from '../crypto/client-ip-signature';

describe('AppThrottlerGuard', () => {
  let guard: AppThrottlerGuard;

  beforeEach(() => {
    // Constructor de ThrottlerGuard requiere options, storageService, reflector
    guard = new AppThrottlerGuard(
      { throttlers: [{ ttl: 60000, limit: 100 }] },
      {} as never,
      {} as never,
    );
  });

  describe('getTracker', () => {
    it('debe priorizar req.ip resuelto por Express (trust proxy) sobre cualquier cabecera', async () => {
      const mockReq = {
        headers: {
          'cf-connecting-ip': '203.0.113.195',
          'x-forwarded-for': '198.51.100.1',
        },
        ip: '10.0.0.1',
      };

      const tracker = await (
        guard as unknown as {
          getTracker: (req: unknown) => Promise<string>;
        }
      ).getTracker(mockReq);

      expect(tracker).toBe('10.0.0.1');
    });

    it('debe usar x-forwarded-for cuando Express no resolvió req.ip/req.ips', async () => {
      const mockReq = {
        headers: {
          'cf-connecting-ip': '203.0.113.195',
          'x-forwarded-for': '198.51.100.1, 10.0.0.2',
        },
        ip: undefined,
      };

      const tracker = await (
        guard as unknown as {
          getTracker: (req: unknown) => Promise<string>;
        }
      ).getTracker(mockReq);

      expect(tracker).toBe('198.51.100.1');
    });

    it('debe usar cf-connecting-ip solo como último recurso si no hay req.ip ni x-forwarded-for', async () => {
      const mockReq = {
        headers: {
          'cf-connecting-ip': '203.0.113.195',
        },
        ip: undefined,
      };

      const tracker = await (
        guard as unknown as {
          getTracker: (req: unknown) => Promise<string>;
        }
      ).getTracker(mockReq);

      expect(tracker).toBe('203.0.113.195');
    });

    it('debe usar req.ip como fallback si no hay cabeceras de proxy', async () => {
      const mockReq = {
        headers: {},
        ip: '192.168.1.50',
      };

      const tracker = await (
        guard as unknown as {
          getTracker: (req: unknown) => Promise<string>;
        }
      ).getTracker(mockReq);

      expect(tracker).toBe('192.168.1.50');
    });
  });

  describe('IP del visitante firmada por el front', () => {
    const SECRET = 'secreto-compartido';
    const tracker = (req: unknown) =>
      (
        guard as unknown as { getTracker: (r: unknown) => Promise<string> }
      ).getTracker(req);
    const skip = (req: unknown) =>
      (
        guard as unknown as { shouldSkip: (c: unknown) => Promise<boolean> }
      ).shouldSkip({
        switchToHttp: () => ({ getRequest: () => req }),
        getHandler: () => undefined,
        getClass: () => undefined,
      });
    const signedHeaders = (ip: string, ts: string, secret = SECRET) => ({
      'x-client-ip': ip,
      'x-client-ip-ts': ts,
      'x-client-ip-sig': signClientIp(secret, ip, ts),
    });
    let prev: string | undefined;

    beforeEach(() => {
      prev = process.env.REVALIDATE_SECRET;
      process.env.REVALIDATE_SECRET = SECRET;
      // shouldSkip del padre consulta el reflector (@SkipThrottle).
      (guard as unknown as { reflector: unknown }).reflector = {
        getAllAndOverride: () => false,
      };
    });
    afterEach(() => {
      process.env.REVALIDATE_SECRET = prev;
    });

    it('usa la IP firmada en vez de la del servidor del front', async () => {
      const now = String(Math.floor(Date.now() / 1000));
      await expect(
        tracker({ headers: signedHeaders('203.0.113.7', now), ip: '10.0.0.1' }),
      ).resolves.toBe('203.0.113.7');
    });

    it('ignora una IP con firma inválida (un cliente no puede elegir su IP)', async () => {
      const now = String(Math.floor(Date.now() / 1000));
      await expect(
        tracker({
          headers: signedHeaders('203.0.113.7', now, 'adivinado'),
          ip: '10.0.0.1',
        }),
      ).resolves.toBe('10.0.0.1');
    });

    it('salta el límite solo en lecturas del servidor del front sin visitante', async () => {
      await expect(
        skip({ method: 'GET', headers: signedHeaders('', '0') }),
      ).resolves.toBe(true);
      await expect(
        skip({ method: 'POST', headers: signedHeaders('', '0') }),
      ).resolves.toBe(false);
      await expect(
        skip({ method: 'GET', headers: signedHeaders('', '0', 'otro') }),
      ).resolves.toBe(false);
      await expect(skip({ method: 'GET', headers: {} })).resolves.toBe(false);
    });
  });
});
