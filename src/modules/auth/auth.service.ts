import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import type { JwtPayload } from '../../common/guards/auth.guard';
import type { CurrentUserData } from '../../common/decorators/current-user.decorator';

const LOGIN_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 min (validez del enlace)
const SESSION_TTL = '7d'; // duración de la sesión de operador tras el login
const GENERIC_RESPONSE = {
  message:
    'Si el correo corresponde a un operador, te enviamos un enlace de acceso.',
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
  ) {}

  /**
   * Paso 1 del magic link: genera un token de un solo uso y envía el enlace de
   * acceso por correo. Responde siempre genérico para no revelar qué correos
   * son operadores válidos (anti-enumeración).
   */
  async requestMagicLink(email: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { memberships: { select: { tenantId: true } } },
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
      await this.sendMagicLinkEmail(user.email, user.name, rawToken);
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

    const accessToken = await this.signToken({
      sub: user.id,
      email: user.email,
      type: 'operator',
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

  // Nota: getMe y verifyMagicLink usan signToken; este firma con SESSION_TTL.

  getMe(user: CurrentUserData) {
    const ownerEmail = this.config.get<string>('platformOwnerEmail');
    return {
      ...user,
      isPlatformOwner: !!ownerEmail && user.email === ownerEmail,
    };
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

  private async sendMagicLinkEmail(
    email: string,
    name: string | null,
    rawToken: string,
  ): Promise<void> {
    const webUrl = this.config.get<string>('webAppUrl') ?? 'http://localhost:3000';
    const link = `${webUrl}/acceso/verificar?token=${rawToken}&email=${encodeURIComponent(email)}`;
    await this.mail.sendOperatorMagicLink(email, name, link);
  }
}
