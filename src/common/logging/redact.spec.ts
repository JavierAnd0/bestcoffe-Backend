import { Writable } from 'node:stream';
import pinoHttp from 'pino-http';
import { LOG_REDACT } from './redact';

/** Captura las líneas que escribe pino en memoria. */
function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  return { lines, stream };
}

describe('LOG_REDACT · secretos fuera de los registros', () => {
  it('censura sesión, secreto interno, firma de IP y set-cookie', () => {
    const { lines, stream } = capture();
    const { logger } = pinoHttp({ redact: LOG_REDACT }, stream);

    logger.info({
      req: {
        headers: {
          authorization: 'Bearer dummy.auth.value',
          cookie: 'customer_token=dummy.jwt.value',
          'x-internal-secret': 'dummy-secret-0123456789',
          'x-revalidate-secret': 'dummy-secret-0123456789',
          'x-client-ip-sig': 'dummy-sig-abcdef',
          'x-tenant-slug': 'origen',
        },
      },
      res: {
        headers: { 'set-cookie': 'customer_token=dummy.setcookie.value' },
      },
    });

    const out = lines.join('');
    for (const secret of [
      'dummy.auth.value',
      'dummy.jwt.value',
      'dummy-secret-0123456789',
      'dummy-sig-abcdef',
      'dummy.setcookie.value',
    ]) {
      expect(out).not.toContain(secret);
    }
    expect(out).toContain('[REDACTED]');
    // Lo que no es secreto se sigue registrando.
    expect(out).toContain('origen');
  });
});
