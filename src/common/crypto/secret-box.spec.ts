import { deriveSecretBoxKey, isSealed, open, seal } from './secret-box';

describe('secret-box (cifrado de tokens en reposo)', () => {
  const key = deriveSecretBoxKey({
    JWT_SECRET: 'secreto-de-prueba-0123456789',
  });

  it('lo cifrado no contiene el valor original y se recupera con la clave', () => {
    const sealed = seal('APP_USR-token-real', key);
    expect(isSealed(sealed)).toBe(true);
    expect(sealed).not.toContain('APP_USR-token-real');
    expect(open(sealed, key)).toBe('APP_USR-token-real');
  });

  it('cada cifrado es distinto aunque el valor sea el mismo', () => {
    expect(seal('igual', key)).not.toBe(seal('igual', key));
  });

  it('un valor heredado en texto plano se devuelve tal cual', () => {
    expect(isSealed('APP_USR-plano')).toBe(false);
    expect(open('APP_USR-plano', key)).toBe('APP_USR-plano');
  });

  it('con otra clave no se puede leer', () => {
    const other = deriveSecretBoxKey({
      JWT_SECRET: 'otro-secreto-distinto-987',
    });
    expect(() => open(seal('token', key), other)).toThrow();
  });

  it('un valor manipulado se rechaza en vez de devolver basura', () => {
    const sealed = seal('token', key);
    const tampered =
      sealed.slice(0, -2) + (sealed.endsWith('AA') ? 'BB' : 'AA');
    expect(() => open(tampered, key)).toThrow();
  });

  it('TOKEN_ENCRYPTION_KEY tiene prioridad sobre JWT_SECRET', () => {
    const a = deriveSecretBoxKey({
      JWT_SECRET: 'x',
      TOKEN_ENCRYPTION_KEY: 'k1',
    });
    const b = deriveSecretBoxKey({
      JWT_SECRET: 'x',
      TOKEN_ENCRYPTION_KEY: 'k2',
    });
    expect(a.equals(b)).toBe(false);
  });
});
