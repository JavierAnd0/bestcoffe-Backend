import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { MfaService } from './mfa.service';
import { platformUrl, storeUrl } from '../../common/urls/store-url';
import type { JwtPayload } from '../../common/guards/auth.guard';
import type { CurrentUserData } from '../../common/decorators/current-user.decorator';

const LOGIN_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 min (validez del enlace)
const SESSION_TTL = '7d'; // duración de la sesión de operador tras el login
const MFA_PENDING_TTL = '5m'; // tiempo para escribir el código de 2FA tras el enlace
const IMPERSONATION_TTL = '2h'; // sesión del superadmin dentro de una tienda
const GENERIC_RESPONSE = {
  message:
    'Si el correo corresponde a un operador, te enviamos un enlace de acceso.',
};

@Injectable()
export class AuthService {
  // Pases de impersonación ya canjeados (jti → vence). Viven un minuto, así que
  // basta con recordarlos en memoria ese tiempo.
  private readonly usedImpersonationIds = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
    private readonly mfa: MfaService,
  ) {}

  /**
   * Paso 1 del magic link: genera un token de un solo uso y envía el enlace de
   * acceso por correo. Responde siempre genérico para no revelar qué correos
   * son operadores válidos (anti-enumeración).
   */
  async requestMagicLink(email: string, tenantSlug?: string | null) {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: {
        memberships: {
          select: { tenantId: true, tenant: { select: { slug: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    // Solo enviamos enlace a operadores con al menos una membresía.
    if (user && user.memberships.length > 0) {
      const { rawToken, hashedToken } = this.generateLoginToken();
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          loginToken: hashedToken,
          loginTokenExpiresAt: new Date(Date.now() + LOGIN_TOKEN_TTL_MS),
        },
      });
      await this.sendMagicLinkEmail(
        user.email,
        user.name,
        rawToken,
        this.magicLinkTarget(user.email, user.memberships, tenantSlug),
      );
    }

    return GENERIC_RESPONSE;
  }

  /**
   * Paso 2 del magic link: valida el token (hash + expiración), lo consume
   * (single-use) y emite el JWT de operador.
   */
  async verifyMagicLink(email: string, token: string) {
    const hashedToken = this.hashToken(token);

    const user = await this.prisma.user.findFirst({
      where: {
        email,
        loginToken: hashedToken,
        loginTokenExpiresAt: { gt: new Date() },
      },
      include: {
        memberships: { include: { tenant: { select: { slug: true } } } },
      },
    });

    if (!user) {
      throw new UnauthorizedException(
        'El enlace de acceso es inválido o ha expirado.',
      );
    }

    // Consumir el token: un enlace solo sirve una vez.
    await this.prisma.user.update({
      where: { id: user.id },
      data: { loginToken: null, loginTokenExpiresAt: null },
    });

    // Con 2FA activo el enlace no basta: se entrega un token de paso pendiente
    // (5 min, no abre ninguna ruta) que se canjea junto con el código.
    if (user.totpEnabledAt) {
      const mfaToken = await this.jwt.signAsync(
        { sub: user.id, email: user.email, type: 'mfa_pending' },
        { expiresIn: MFA_PENDING_TTL },
      );
      return { mfaRequired: true as const, mfaToken };
    }

    // Sin 2FA activo: sesión sin la marca `mfa`. Para la cuenta de la
    // plataforma esa sesión solo abre /v1/auth/* (para activarlo).
    return this.issueSession(user, false);
  }

  /** Paso 3 (solo con 2FA): código de la app o de respaldo → sesión. */
  async verifyMfa(mfaToken: string, code: string) {
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(mfaToken, {
        secret: this.config.get<string>('jwt.secret'),
      });
    } catch {
      throw new UnauthorizedException(
        'Tu acceso expiró. Vuelve a pedir el enlace de acceso.',
      );
    }
    if (payload.type !== 'mfa_pending') {
      throw new UnauthorizedException('Token de verificación inválido.');
    }
    if (!(await this.mfa.verifyCode(payload.sub, code))) {
      throw new UnauthorizedException(
        'El código no es válido. Revisa la hora del teléfono e inténtalo de nuevo.',
      );
    }
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: payload.sub },
      include: {
        memberships: { include: { tenant: { select: { slug: true } } } },
      },
    });
    return this.issueSession(user, true);
  }

  /**
   * Sesión nueva con la marca `mfa` justo después de activar el 2FA: el
   * operador acaba de probar el código, no hace falta que vuelva a entrar.
   */
  async sessionAfterMfaSetup(user: { id: string; email: string }) {
    return this.signToken({
      sub: user.id,
      email: user.email,
      type: 'operator',
      mfa: true,
    });
  }

  private async issueSession(
    user: {
      id: string;
      email: string;
      name: string | null;
      memberships: { role: string; tenant: { slug: string } }[];
    },
    mfa: boolean,
  ) {
    const accessToken = await this.signToken({
      sub: user.id,
      email: user.email,
      type: 'operator',
      ...(mfa && { mfa: true }),
    });

    const ownerEmail = this.config.get<string>('platformOwnerEmail');
    const isPlatformOwner = !!ownerEmail && user.email === ownerEmail;

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        isPlatformOwner,
        tenants: user.memberships.map((m) => ({
          slug: m.tenant.slug,
          role: m.role,
        })),
      },
    };
  }

  /**
   * Canjea el pase de impersonación (lo emite el panel de la plataforma) por una
   * sesión de 2 h como dueño de esa tienda. Se llama desde el dominio de la
   * tienda para que la cookie quede allí. El pase vale un minuto y una sola vez.
   */
  async exchangeImpersonation(token: string) {
    let payload: JwtPayload & { exp?: number };
    try {
      payload = await this.jwt.verifyAsync(token, {
        secret: this.config.get<string>('jwt.secret'),
      });
    } catch {
      throw new UnauthorizedException(
        'El acceso a la tienda expiró. Vuelve a entrar desde el panel de la plataforma.',
      );
    }
    if (payload.type !== 'impersonation' || !payload.tenantId || !payload.jti) {
      throw new UnauthorizedException('Pase de acceso inválido.');
    }

    const now = Date.now();
    for (const [id, exp] of this.usedImpersonationIds) {
      if (exp <= now) this.usedImpersonationIds.delete(id);
    }
    if (this.usedImpersonationIds.has(payload.jti)) {
      throw new UnauthorizedException(
        'Este acceso ya se usó. Vuelve a entrar desde el panel de la plataforma.',
      );
    }
    this.usedImpersonationIds.set(
      payload.jti,
      (payload.exp ?? now / 1000 + 60) * 1000,
    );

    // Sigue siendo el dueño de esa tienda (pudo cambiar en ese minuto).
    const membership = await this.prisma.tenantMembership.findFirst({
      where: {
        tenantId: payload.tenantId,
        userId: payload.sub,
        role: 'TENANT_OWNER',
      },
      select: { tenant: { select: { slug: true, name: true } } },
    });
    if (!membership)
      throw new UnauthorizedException('Pase de acceso inválido.');

    // `mfa: true`: el pase solo lo emite una sesión de plataforma con 2FA. Sin
    // la marca, si el dueño de la tienda es la propia cuenta de la plataforma,
    // la API le respondería MFA_REQUIRED en cada ruta.
    const accessToken = await this.jwt.signAsync(
      {
        sub: payload.sub,
        email: payload.email,
        type: 'operator',
        mfa: true,
      } satisfies JwtPayload,
      { expiresIn: IMPERSONATION_TTL },
    );
    return {
      accessToken,
      tenant: { slug: membership.tenant.slug, name: membership.tenant.name },
    };
  }

  // Nota: getMe y verifyMagicLink usan signToken; este firma con SESSION_TTL.

  async getMe(user: CurrentUserData, tenantSlug?: string) {
    const ownerEmail = this.config.get<string>('platformOwnerEmail');
    const isPlatformOwner = !!ownerEmail && user.email === ownerEmail;
    // Cuenta de la plataforma sin sesión con 2FA: 'setup' si aún no lo activó,
    // 'login' si ya lo tiene pero esta sesión se abrió sin el código.
    let mfaRequired: 'setup' | 'login' | null = null;
    if (isPlatformOwner && user.mfa !== true) {
      const row = await this.prisma.user.findUnique({
        where: { id: user.id },
        select: { totpEnabledAt: true },
      });
      mfaRequired = row?.totpEnabledAt ? 'login' : 'setup';
    }
    const me = { ...user, isPlatformOwner, mfaRequired };
    const slug = tenantSlug?.trim();
    if (!slug) return me;

    // Rol en la tienda pedida (aislado por tienda: solo su propia membresía).
    const membership = await this.prisma.tenantMembership.findFirst({
      where: { userId: user.id, tenant: { slug } },
      select: { role: true },
    });
    return { ...me, tenantRole: membership?.role ?? null };
  }

  isPlatformOwner(email: string): boolean {
    const ownerEmail = this.config.get<string>('platformOwnerEmail');
    return !!ownerEmail && email === ownerEmail;
  }

  signToken(payload: JwtPayload): Promise<string> {
    // El JwtModule global usa expiresIn corto (15m, pensado para access tokens
    // con refresh). La sesión de operador no tiene refresh todavía, así que
    // firmamos con una duración de sesión más larga.
    return this.jwt.signAsync(payload, { expiresIn: SESSION_TTL });
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private generateLoginToken(): { rawToken: string; hashedToken: string } {
    const rawToken = randomBytes(32).toString('hex');
    return { rawToken, hashedToken: this.hashToken(rawToken) };
  }

  private hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  /**
   * A dónde lleva el enlace de acceso (la sesión queda en ese host):
   * - a la tienda desde la que se pidió, si el operador es miembro de ella;
   * - al dominio de la plataforma si lo pidió ahí el dueño de la plataforma;
   * - si no, a su primera tienda.
   */
  private magicLinkTarget(
    email: string,
    memberships: Array<{ tenantId: string; tenant: { slug: string } }>,
    tenantSlug?: string | null,
  ): { url: string; tenantId: string | null } {
    const asked = tenantSlug?.trim().toLowerCase();
    const match = asked
      ? memberships.find((m) => m.tenant.slug === asked)
      : undefined;
    if (match) {
      return {
        url: storeUrl(match.tenant.slug, this.config),
        tenantId: match.tenantId,
      };
    }
    const owner = this.config.get<string>('platformOwnerEmail');
    if (!asked && owner && owner.toLowerCase() === email.toLowerCase()) {
      return { url: platformUrl(this.config), tenantId: null };
    }
    const first = memberships[0];
    return {
      url: storeUrl(first?.tenant.slug, this.config),
      tenantId: first?.tenantId ?? null,
    };
  }

  private async sendMagicLinkEmail(
    email: string,
    name: string | null,
    rawToken: string,
    target: { url: string; tenantId: string | null },
  ): Promise<void> {
    const link = `${target.url}/acceso/verificar?token=${rawToken}&email=${encodeURIComponent(email)}`;
    await this.mail.sendOperatorMagicLink(email, name, link, target.tenantId);
  }
}
