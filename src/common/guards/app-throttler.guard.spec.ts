import { AppThrottlerGuard } from './app-throttler.guard';

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
});
