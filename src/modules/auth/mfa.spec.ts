import {
  ForbiddenException,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ClsService } from 'nestjs-cls';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { AuthGuard } from '../../common/guards/auth.guard';
import { base32Decode, hotp, totpStep } from '../../common/crypto/totp';
import { AuthService } from './auth.service';
import { MfaService } from './mfa.service';

const SECRET = 'test-jwt-secret';

/** Usuario en memoria con la forma que lee Prisma en estos flujos. */
interface FakeUser {
  id: string;
  email: string;
  name: string | null;
  loginToken: string | null;
  loginTokenExpiresAt: Date | null;
  totpSecret: string | null;
  totpPendingSecret: string | null;
  totpEnabledAt: Date | null;
  totpLastStep: number | null;
  totpRecoveryCodes: string[];
  memberships: { role: string; tenant: { slug: string } }[];
}

function fakePrisma(user: FakeUser) {
  const matches = (where: Record<string, unknown>) => {
    if (where.id && where.id !== user.id) return false;
    const or = where.OR as Record<string, unknown>[] | undefined;
    if (or) {
      const ok = or.some((c) =>
        c.totpLastStep === null
          ? user.totpLastStep === null
          : user.totpLastStep !== null &&
            user.totpLastStep < (c.totpLastStep as { lt: number }).lt,
      );
      if (!ok) return false;
    }
    const has = (where.totpRecoveryCodes as { has?: string } | undefined)?.has;
    if (has && !user.totpRecoveryCodes.includes(has)) return false;
    return true;
  };
  return {
    user: {
      findUnique: jest.fn(() => Promise.resolve({ ...user })),
      findUniqueOrThrow: jest.fn(() => Promise.resolve({ ...user })),
      findFirst: jest.fn(({ where }: { where: { loginToken: string } }) =>
        Promise.resolve(
          where.loginToken === user.loginToken ? { ...user } : null,
        ),
      ),
      update: jest.fn(({ data }: { data: Partial<FakeUser> }) => {
        Object.assign(user, data);
        return Promise.resolve({ ...user });
      }),
      updateMany: jest.fn(
        ({
          where,
          data,
        }: {
          where: Record<string, unknown>;
          data: Partial<FakeUser>;
        }) => {
          if (!matches(where)) return Promise.resolve({ count: 0 });
          Object.assign(user, data);
          return Promise.resolve({ count: 1 });
        },
      ),
    },
  };
}

describe('2FA de operadores', () => {
  let user: FakeUser;
  let mfa: MfaService;
  let auth: AuthService;
  let jwt: JwtService;
  const config = {
    get: (k: string) => (k === 'jwt.secret' ? SECRET : undefined),
  } as unknown as ConfigService;

  const codeFor = (secretB32: string, offsetSteps = 0) =>
    hotp(base32Decode(secretB32), totpStep() + offsetSteps);

  beforeEach(() => {
    user = {
      id: 'u1',
      email: 'ana@cafe.co',
      name: 'Ana',
      loginToken: null,
      loginTokenExpiresAt: null,
      totpSecret: null,
      totpPendingSecret: null,
      totpEnabledAt: null,
      totpLastStep: null,
      totpRecoveryCodes: [],
      memberships: [{ role: 'TENANT_OWNER', tenant: { slug: 'origen' } }],
    };
    const prisma = fakePrisma(user) as unknown as PrismaService;
    jwt = new JwtService({ secret: SECRET });
    mfa = new MfaService(prisma);
    auth = new AuthService(prisma, jwt, config, {} as MailService, mfa);
  });

  async function enable() {
    const { secret } = await mfa.startSetup('u1', user.email);
    // Un código del paso anterior: así el siguiente login puede usar el actual.
    const { recoveryCodes } = await mfa.confirmSetup('u1', codeFor(secret, -1));
    return { secret, recoveryCodes };
  }

  it('la activación guarda el secreto cifrado y devuelve 10 códigos de respaldo', async () => {
    const { secret, recoveryCodes } = await enable();
    expect(user.totpEnabledAt).toBeInstanceOf(Date);
    expect(user.totpSecret).toMatch(/^enc:v1:/);
    expect(user.totpSecret).not.toContain(secret);
    expect(user.totpPendingSecret).toBeNull();
    expect(recoveryCodes).toHaveLength(10);
    expect(user.totpRecoveryCodes).not.toContain(recoveryCodes[0]);
  });

  it('la activación rechaza un código equivocado y no activa nada', async () => {
    await mfa.startSetup('u1', user.email);
    await expect(mfa.confirmSetup('u1', '000000')).rejects.toMatchObject({
      status: 400,
    });
    expect(user.totpEnabledAt).toBeNull();
  });

  it('un código de la app sirve una sola vez', async () => {
    const { secret } = await enable();
    const code = codeFor(secret);
    expect(await mfa.verifyCode('u1', code)).toBe(true);
    expect(await mfa.verifyCode('u1', code)).toBe(false);
  });

  it('un código de respaldo se consume al usarlo', async () => {
    const { recoveryCodes } = await enable();
    expect(await mfa.verifyCode('u1', recoveryCodes[0].toUpperCase())).toBe(
      true,
    );
    expect(await mfa.verifyCode('u1', recoveryCodes[0])).toBe(false);
    expect(user.totpRecoveryCodes).toHaveLength(9);
  });

  it('con 2FA el enlace mágico no entrega sesión, solo el paso pendiente', async () => {
    await enable();
    user.loginToken = (
      auth as unknown as { hashToken(t: string): string }
    ).hashToken('raw');
    const res = await auth.verifyMagicLink(user.email, 'raw');
    expect(res).toMatchObject({ mfaRequired: true });
    expect(res).not.toHaveProperty('accessToken');
  });

  it('código válido + paso pendiente → sesión de operador', async () => {
    const { secret } = await enable();
    const mfaToken = await jwt.signAsync(
      { sub: 'u1', email: user.email, type: 'mfa_pending' },
      { expiresIn: '5m' },
    );
    const res = await auth.verifyMfa(mfaToken, codeFor(secret));
    const payload = await jwt.verifyAsync<{ type: string; mfa?: boolean }>(
      res.accessToken,
    );
    expect(payload.type).toBe('operator');
    // Marca de sesión abierta con 2FA: la exige la cuenta de la plataforma.
    expect(payload.mfa).toBe(true);
  });

  it('sin 2FA el enlace mágico entrega una sesión SIN la marca mfa', async () => {
    user.loginToken = (
      auth as unknown as { hashToken(t: string): string }
    ).hashToken('raw');
    const res = (await auth.verifyMagicLink(user.email, 'raw')) as {
      accessToken: string;
    };
    const payload = await jwt.verifyAsync<{ mfa?: boolean }>(res.accessToken);
    expect(payload.mfa).toBeUndefined();
  });

  it('código inválido o token que no es de paso pendiente → 401', async () => {
    const { secret } = await enable();
    const pending = await jwt.signAsync({
      sub: 'u1',
      email: user.email,
      type: 'mfa_pending',
    });
    await expect(auth.verifyMfa(pending, '000000')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    const session = await jwt.signAsync({
      sub: 'u1',
      email: user.email,
      type: 'operator',
    });
    await expect(
      auth.verifyMfa(session, codeFor(secret)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('desactivar exige un código válido', async () => {
    const { secret } = await enable();
    await expect(mfa.disable('u1', '000000')).rejects.toMatchObject({
      status: 400,
    });
    await mfa.disable('u1', codeFor(secret));
    expect(user.totpEnabledAt).toBeNull();
    expect(user.totpSecret).toBeNull();
  });
});

describe('AuthGuard · solo sesiones de operador', () => {
  const jwt = new JwtService({ secret: SECRET });
  const guard = new AuthGuard(
    jwt,
    { get: () => SECRET } as unknown as ConfigService,
    { getAllAndOverride: () => false } as unknown as Reflector,
    { set: jest.fn() } as unknown as ClsService,
  );
  const ctx = (token: string) =>
    ({
      getHandler: () => null,
      getClass: () => null,
      switchToHttp: () => ({
        getRequest: () => ({ headers: { authorization: `Bearer ${token}` } }),
      }),
    }) as unknown as ExecutionContext;

  it('acepta una sesión de operador', async () => {
    const t = await jwt.signAsync({
      sub: 'u1',
      email: 'a@b.co',
      type: 'operator',
    });
    await expect(guard.canActivate(ctx(t))).resolves.toBe(true);
  });

  it.each([
    [
      'el paso pendiente de 2FA',
      { sub: 'u1', email: 'a@b.co', type: 'mfa_pending' },
    ],
    [
      'el state de OAuth de MercadoPago',
      { sub: 'tenant-1', purpose: 'mp-oauth' },
    ],
  ])('rechaza %s', async (_label, payload) => {
    const t = await jwt.signAsync(payload);
    await expect(guard.canActivate(ctx(t))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});

describe('AuthGuard · cuenta de la plataforma exige 2FA', () => {
  const OWNER = 'root@plataforma.co';
  const jwt = new JwtService({ secret: SECRET });
  const guard = new AuthGuard(
    jwt,
    {
      get: (k: string) => (k === 'platformOwnerEmail' ? OWNER : SECRET),
    } as unknown as ConfigService,
    { getAllAndOverride: () => false } as unknown as Reflector,
    { set: jest.fn() } as unknown as ClsService,
  );
  const ctx = (token: string, url: string) =>
    ({
      getHandler: () => null,
      getClass: () => null,
      switchToHttp: () => ({
        getRequest: () => ({
          headers: { authorization: `Bearer ${token}` },
          originalUrl: url,
        }),
      }),
    }) as unknown as ExecutionContext;
  const session = (email: string, mfa?: boolean) =>
    jwt.signAsync({ sub: 'u1', email, type: 'operator', ...(mfa && { mfa }) });

  it('sin 2FA solo abre /v1/auth/* (ver su cuenta y activarlo)', async () => {
    const t = await session(OWNER);
    await expect(guard.canActivate(ctx(t, '/v1/auth/me'))).resolves.toBe(true);
    await expect(guard.canActivate(ctx(t, '/v1/auth/mfa/setup'))).resolves.toBe(
      true,
    );
    await expect(
      guard.canActivate(ctx(t, '/v1/admin/orders?x=1')),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('con sesión abierta con 2FA opera normal', async () => {
    const t = await session(OWNER, true);
    await expect(guard.canActivate(ctx(t, '/v1/admin/orders'))).resolves.toBe(
      true,
    );
  });

  it('a los operadores de tienda no se les exige', async () => {
    const t = await session('dueno@demo.test');
    await expect(guard.canActivate(ctx(t, '/v1/admin/orders'))).resolves.toBe(
      true,
    );
  });
});
