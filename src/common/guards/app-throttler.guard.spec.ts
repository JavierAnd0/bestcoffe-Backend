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
    it('debe priorizar la cabecera cf-connecting-ip de Cloudflare', async () => {
      const mockReq = {
        headers: {
          'cf-connecting-ip': '203.0.113.195',
          'x-forwarded-for': '198.51.100.1',
        },
        ip: '10.0.0.1',
      };

      // Invocamos el método protegido getTracker
      const tracker = await (
        guard as unknown as {
          getTracker: (req: unknown) => Promise<string>;
        }
      ).getTracker(mockReq);

      expect(tracker).toBe('203.0.113.195');
    });

    it('debe usar la primera IP de x-forwarded-for si cf-connecting-ip no está', async () => {
      const mockReq = {
        headers: {
          'x-forwarded-for': '198.51.100.1, 10.0.0.2',
        },
        ip: '10.0.0.1',
      };

      const tracker = await (
        guard as unknown as {
          getTracker: (req: unknown) => Promise<string>;
        }
      ).getTracker(mockReq);

      expect(tracker).toBe('198.51.100.1');
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

