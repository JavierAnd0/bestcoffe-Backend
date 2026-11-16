import {
  base32Decode,
  base32Encode,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  hotp,
  totpStep,
  totpUri,
  verifyTotp,
} from './totp';

describe('TOTP (RFC 6238)', () => {
  // Vectores oficiales del Apéndice B (SHA1, clave ASCII "12345678901234567890", 8 dígitos).
  const key = Buffer.from('12345678901234567890', 'ascii');
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ])('t=%i produce %s', (t, expected) => {
    expect(hotp(key, Math.floor(t / 30), 8)).toBe(expected);
  });

  it('base32 ida y vuelta', () => {
    const buf = Buffer.from('12345678901234567890', 'ascii');
    expect(base32Encode(buf)).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Decode('gezd gnbv-gy3t qojq gezd gnbv gy3t qojq')).toEqual(
      buf,
    );
  });

  it('acepta el código actual y uno desfasado ±30 s', () => {
    const secret = generateTotpSecret();
    const now = 1_700_000_000_000;
    const code = hotp(base32Decode(secret), totpStep(now));
    expect(verifyTotp(secret, code, { nowMs: now })).toBe(totpStep(now));
    expect(verifyTotp(secret, code, { nowMs: now + 30_000 })).toBe(
      totpStep(now),
    );
    expect(verifyTotp(secret, code, { nowMs: now + 90_000 })).toBeNull();
  });

  it('el mismo código no sirve dos veces', () => {
    const secret = generateTotpSecret();
    const now = 1_700_000_000_000;
    const step = totpStep(now);
    const code = hotp(base32Decode(secret), step);
    expect(verifyTotp(secret, code, { nowMs: now, lastStep: step })).toBeNull();
  });

  it('rechaza formatos que no son 6 dígitos', () => {
    const secret = generateTotpSecret();
    expect(verifyTotp(secret, '12345')).toBeNull();
    expect(verifyTotp(secret, 'abcdef')).toBeNull();
  });

  it('la URI lleva emisor, cuenta y secreto', () => {
    const uri = totpUri('ABC234', 'ana@cafe.co', 'BestCoffee');
    expect(uri).toMatch(/^otpauth:\/\/totp\/BestCoffee%3Aana%40cafe\.co\?/);
    expect(uri).toContain('secret=ABC234');
    expect(uri).toContain('issuer=BestCoffee');
  });

  it('códigos de respaldo: 10 distintos y su hash ignora guion y mayúsculas', () => {
    const codes = generateRecoveryCodes();
    expect(new Set(codes).size).toBe(10);
    expect(codes[0]).toMatch(/^[a-z2-7]{4}-[a-z2-7]{4}$/);
    expect(hashRecoveryCode(codes[0].toUpperCase().replace('-', ''))).toBe(
      hashRecoveryCode(codes[0]),
    );
  });
});
