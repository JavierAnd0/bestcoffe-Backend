import { signClientIp, verifyClientIp } from './client-ip-signature';

const SECRET = 'secreto-de-prueba';
const NOW = 1_800_000_000;

const signed = (ip: string, ts: string, secret = SECRET) => ({
  'x-client-ip': ip,
  'x-client-ip-ts': ts,
  'x-client-ip-sig': signClientIp(secret, ip, ts),
});

describe('verifyClientIp', () => {
  it('acepta una IP firmada reciente', () => {
    expect(
      verifyClientIp(SECRET, signed('203.0.113.7', String(NOW)), NOW),
    ).toEqual({
      valid: true,
      ip: '203.0.113.7',
    });
  });

  it('acepta IPv6', () => {
    const v = verifyClientIp(SECRET, signed('2001:db8::1', String(NOW)), NOW);
    expect(v).toEqual({ valid: true, ip: '2001:db8::1' });
  });

  it('rechaza una firma con otro secreto o una IP cambiada', () => {
    expect(
      verifyClientIp(SECRET, signed('203.0.113.7', String(NOW), 'otro'), NOW),
    ).toEqual({ valid: false });
    const h = signed('203.0.113.7', String(NOW));
    h['x-client-ip'] = '198.51.100.9';
    expect(verifyClientIp(SECRET, h, NOW)).toEqual({ valid: false });
  });

  it('rechaza firmas viejas o del futuro', () => {
    expect(
      verifyClientIp(SECRET, signed('203.0.113.7', String(NOW - 301)), NOW),
    ).toEqual({ valid: false });
    expect(
      verifyClientIp(SECRET, signed('203.0.113.7', String(NOW + 301)), NOW),
    ).toEqual({ valid: false });
  });

  it('sin secreto configurado nunca confía', () => {
    expect(verifyClientIp('', signed('203.0.113.7', String(NOW)), NOW)).toEqual(
      {
        valid: false,
      },
    );
  });

  it('petición del servidor sin visitante: IP vacía y ts "0"', () => {
    expect(verifyClientIp(SECRET, signed('', '0'), NOW)).toEqual({
      valid: true,
      ip: '',
    });
    // IP vacía con otro ts no vale (la firma constante solo admite "0").
    expect(verifyClientIp(SECRET, signed('', String(NOW)), NOW)).toEqual({
      valid: false,
    });
  });

  it('rechaza IPs con formato inválido y cabeceras incompletas', () => {
    expect(
      verifyClientIp(SECRET, signed('1.2.3.4, 5.6.7.8', String(NOW)), NOW),
    ).toEqual({ valid: false });
    expect(verifyClientIp(SECRET, { 'x-client-ip': '1.2.3.4' }, NOW)).toEqual({
      valid: false,
    });
    expect(
      verifyClientIp(
        SECRET,
        { ...signed('1.2.3.4', String(NOW)), 'x-client-ip-sig': 'zz' },
        NOW,
      ),
    ).toEqual({ valid: false });
  });
});
