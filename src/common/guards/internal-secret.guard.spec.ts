import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InternalSecretGuard } from './internal-secret.guard';

describe('InternalSecretGuard', () => {
  const makeContext = (headers: Record<string, string | undefined>) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ headers }),
      }),
    }) as unknown as ExecutionContext;

  it('rechaza en desarrollo cuando REVALIDATE_SECRET está vacío (fail-closed fuera de test)', () => {
    const config = {
      get: jest.fn((key: string) =>
        key === 'revalidate.secret' ? '' : 'development',
      ),
    } as unknown as ConfigService;

    const guard = new InternalSecretGuard(config);
    expect(() => guard.canActivate(makeContext({}))).toThrow(
      UnauthorizedException,
    );
  });

  it('permite el paso únicamente en NODE_ENV=test cuando REVALIDATE_SECRET está vacío', () => {
    const config = {
      get: jest.fn((key: string) =>
        key === 'revalidate.secret' ? '' : 'test',
      ),
    } as unknown as ConfigService;

    const guard = new InternalSecretGuard(config);
    expect(guard.canActivate(makeContext({}))).toBe(true);
  });

  it('rechaza cuando el header no está presente y hay secreto configurado', () => {
    const config = {
      get: jest.fn((key: string) =>
        key === 'revalidate.secret' ? 'super-secret-123456' : 'production',
      ),
    } as unknown as ConfigService;

    const guard = new InternalSecretGuard(config);
    expect(() => guard.canActivate(makeContext({}))).toThrow(
      UnauthorizedException,
    );
  });

  it('rechaza cuando el header no coincide con el secreto', () => {
    const config = {
      get: jest.fn((key: string) =>
        key === 'revalidate.secret' ? 'super-secret-123456' : 'production',
      ),
    } as unknown as ConfigService;

    const guard = new InternalSecretGuard(config);
    expect(() =>
      guard.canActivate(makeContext({ 'x-internal-secret': 'wrong-secret' })),
    ).toThrow(UnauthorizedException);
  });

  it('permite el paso con x-internal-secret o x-revalidate-secret válido', () => {
    const config = {
      get: jest.fn((key: string) =>
        key === 'revalidate.secret' ? 'super-secret-123456' : 'production',
      ),
    } as unknown as ConfigService;

    const guard = new InternalSecretGuard(config);
    expect(
      guard.canActivate(
        makeContext({ 'x-internal-secret': 'super-secret-123456' }),
      ),
    ).toBe(true);
    expect(
      guard.canActivate(
        makeContext({ 'x-revalidate-secret': 'super-secret-123456' }),
      ),
    ).toBe(true);
  });
});
