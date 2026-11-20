import { createHmac } from 'node:crypto';
import {
  mapEnviaStatus,
  normalizePlaceName,
  packageWeightKg,
  verifyEnviaSignature,
} from './envia-status';

describe('mapEnviaStatus', () => {
  it.each([
    ['created', 'LABEL_CREATED'],
    ['Pending', 'LABEL_CREATED'],
    [1, 'LABEL_CREATED'],
    ['picked up', 'IN_TRANSIT'],
    ['Shipped', 'IN_TRANSIT'],
    ['out_for_delivery', 'IN_TRANSIT'],
    ['2 delivery attempts', 'IN_TRANSIT'],
    [9, 'IN_TRANSIT'],
    ['delivered', 'DELIVERED'],
    ['3', 'DELIVERED'],
    ['Canceled', 'CANCELLED'],
    ['address error', 'EXCEPTION'],
    ['returned', 'EXCEPTION'],
    [10, 'EXCEPTION'],
  ])('%p → %s', (raw, expected) => {
    expect(mapEnviaStatus(raw)).toBe(expected);
  });

  it.each([['information'], [5], [''], [null], [undefined]])(
    '%p es informativo y no cambia nada',
    (raw) => {
      expect(mapEnviaStatus(raw)).toBeNull();
    },
  );
});

describe('verifyEnviaSignature', () => {
  const secret = 'shh';
  const body = '{"type":"tracking.simple","data":{"tracking_number":"123"}}';
  const now = 1_763_500_000_000;
  const sign = (ts: string, encoding: 'hex' | 'base64' = 'hex') =>
    'v1=' +
    createHmac('sha256', secret)
      .update(`${ts}.tracking.simple.${body}`)
      .digest(encoding);

  const verify = (
    overrides: Partial<Parameters<typeof verifyEnviaSignature>[0]>,
  ) =>
    verifyEnviaSignature({
      secret,
      signature: sign(String(now)),
      timestamp: String(now),
      event: 'tracking.simple',
      rawBody: body,
      now,
      ...overrides,
    });

  it('acepta una firma hex con timestamp en milisegundos', () => {
    expect(verify({})).toBe(true);
  });

  it('acepta base64 y timestamp en segundos', () => {
    const ts = String(Math.floor(now / 1000));
    expect(verify({ timestamp: ts, signature: sign(ts, 'base64') })).toBe(true);
  });

  it('rechaza un cuerpo alterado', () => {
    expect(verify({ rawBody: body.replace('123', '999') })).toBe(false);
  });

  it('rechaza otro secreto', () => {
    expect(verify({ secret: 'otro' })).toBe(false);
  });

  it('rechaza un aviso viejo (reenvío)', () => {
    const old = String(now - 60 * 60 * 1000);
    expect(verify({ timestamp: old, signature: sign(old) })).toBe(false);
  });

  it('rechaza sin firma o sin evento', () => {
    expect(verify({ signature: undefined })).toBe(false);
    expect(verify({ event: undefined })).toBe(false);
    expect(verify({ signature: 'garbage' })).toBe(false);
  });
});

describe('normalizePlaceName', () => {
  it('ignora tildes, mayúsculas y "D.C."', () => {
    expect(normalizePlaceName('Bogotá D.C.')).toBe('bogota');
    expect(normalizePlaceName('  ATLÁNTICO ')).toBe('atlantico');
    expect(normalizePlaceName('Norte de Santander')).toBe('norte de santander');
  });
});

describe('packageWeightKg', () => {
  it('suma el café y el empaque y redondea hacia arriba a 0,1 kg', () => {
    expect(
      packageWeightKg(
        [
          { sizeGrams: 500, quantity: 2 },
          { sizeGrams: 250, quantity: 1 },
        ],
        150,
      ),
    ).toBe(1.4);
  });

  it('nunca baja de 1 kg', () => {
    expect(packageWeightKg([{ sizeGrams: 250, quantity: 1 }], 100)).toBe(1);
  });
});
