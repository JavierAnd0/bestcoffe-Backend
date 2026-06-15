import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import type { JwtPayload } from '../../common/guards/auth.guard';
import type { CurrentUserData } from '../../common/decorators/current-user.decorator';

const LOGIN_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 min
const GENERIC_RESPONSE = {
  message:
    'Si el correo corresponde a un operador, te enviamos un enlace de acceso.',
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
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

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        tenants: user.memberships.map((m) => ({
          slug: m.tenant.slug,
          role: m.role,
        })),
      },
    };
  }

  getMe(user: CurrentUserData) {
    const ownerEmail = this.config.get<string>('platformOwnerEmail');
    return {
      ...user,
      isPlatformOwner: !!ownerEmail && user.email === ownerEmail,
    };
  }

  signToken(payload: JwtPayload): Promise<string> {
    // secret + expiresIn vienen del JwtModule (CommonModule).
    return this.jwt.signAsync(payload);
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
    const link = `${webUrl}/admin/verificar?token=${rawToken}&email=${encodeURIComponent(email)}`;

    const apiKey = this.config.get<string>('resend.apiKey');
    if (!apiKey) {
      // Sin RESEND_API_KEY: loguea el link para poder acceder manualmente.
      this.logger.warn(
        `[EMAIL NOT SENT — configure RESEND_API_KEY] Magic link for ${email}: ${link}`,
      );
      return;
    }

    const { Resend } = await import('resend');
    const resend = new Resend(apiKey);
    const from = this.config.get<string>('resend.from') ?? 'noreply@example.com';
    const greeting = name ? `Hola ${name}` : 'Hola';

    await resend.emails.send({
      from,
      to: email,
      subject: 'Tu enlace de acceso',
      html: `
        <p>${greeting},</p>
        <p>Haz clic en el siguiente enlace para acceder a tu panel.
           El enlace vence en 15 minutos y solo puede usarse una vez.</p>
        <p><a href="${link}">Acceder al panel</a></p>
        <p>Si no solicitaste este acceso, ignora este mensaje.</p>
      `,
    });
  }
}
