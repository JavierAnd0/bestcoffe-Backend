import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { hash as argon2Hash, verify as argon2Verify } from '@node-rs/argon2';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import type { RegisterCustomerDto } from './dto/register-customer.dto';
import type { VerifyEmailDto } from './dto/verify-email.dto';
import type { CustomerLoginDto } from './dto/customer-login.dto';
import type { CustomerJwtPayload } from '../../common/guards/customer-auth.guard';

const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 h
const SESSION_TTL = '30d';

@Injectable()
export class CustomerAuthService {
  private readonly logger = new Logger(CustomerAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  // ─── Register ────────────────────────────────────────────────────────────

  async register(tenantId: string, dto: RegisterCustomerDto) {
    const existing = await this.prisma.customer.findUnique({
      where: { tenantId_email: { tenantId, email: dto.email } },
    });
    if (existing) {
      throw new ConflictException('Ya existe una cuenta con ese correo');
    }

    const passwordHash = await argon2Hash(dto.password);
    const { rawToken, hashedToken } = this.generateVerifyToken();
    const expiresAt = new Date(Date.now() + VERIFY_TOKEN_TTL_MS);

    await this.prisma.customer.create({
      data: {
        tenantId,
        email: dto.email,
        name: dto.name,
        passwordHash,
        emailVerified: false,
        emailVerifyToken: hashedToken,
        emailVerifyExpiresAt: expiresAt,
      },
    });

    await this.sendVerificationEmail(dto.email, dto.name, rawToken);

    return {
      message:
        'Cuenta creada. Revisa tu correo y haz clic en el enlace para activarla.',
    };
  }

  // ─── Verify email ────────────────────────────────────────────────────────

  async verifyEmail(dto: VerifyEmailDto) {
    const hashedToken = this.hashToken(dto.token);

    const customer = await this.prisma.customer.findFirst({
      where: {
        email: dto.email,
        emailVerifyToken: hashedToken,
        emailVerifyExpiresAt: { gt: new Date() },
      },
    });

    if (!customer) {
      throw new BadRequestException(
        'El enlace de verificación es inválido o ha expirado.',
      );
    }

    await this.prisma.customer.update({
      where: { id: customer.id },
      data: {
        emailVerified: true,
        emailVerifyToken: null,
        emailVerifyExpiresAt: null,
      },
    });

    const accessToken = await this.signToken(
      customer.id,
      customer.email,
      customer.tenantId,
    );
    return {
      accessToken,
      customer: { id: customer.id, email: customer.email, name: customer.name },
    };
  }

  // ─── Login ───────────────────────────────────────────────────────────────

  async login(tenantId: string, dto: CustomerLoginDto) {
    const customer = await this.prisma.customer.findUnique({
      where: { tenantId_email: { tenantId, email: dto.email } },
    });

    // Mismo mensaje para cuenta inexistente y sin contraseña — evita enumerar.
    if (!customer || !customer.passwordHash) {
      throw new UnauthorizedException('Correo o contraseña incorrectos');
    }

    if (!customer.emailVerified) {
      throw new UnauthorizedException(
        'Debes verificar tu correo antes de iniciar sesión. Revisa tu bandeja de entrada.',
      );
    }

    const passwordOk = await argon2Verify(customer.passwordHash, dto.password);
    if (!passwordOk) {
      throw new UnauthorizedException('Correo o contraseña incorrectos');
    }

    const accessToken = await this.signToken(
      customer.id,
      customer.email,
      customer.tenantId,
    );
    return {
      accessToken,
      customer: { id: customer.id, email: customer.email, name: customer.name },
    };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private generateVerifyToken(): { rawToken: string; hashedToken: string } {
    const rawToken = randomBytes(32).toString('hex');
    return { rawToken, hashedToken: this.hashToken(rawToken) };
  }

  private hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  private signToken(
    customerId: string,
    email: string,
    tenantId: string,
  ): Promise<string> {
    const payload: CustomerJwtPayload = {
      sub: customerId,
      email,
      tenantId,
      type: 'customer',
    };
    // Sesiones de cliente duran 30 días (HttpOnly cookie en el navegador).
    return this.jwt.signAsync(payload, { expiresIn: SESSION_TTL });
  }

  // ─── Email ───────────────────────────────────────────────────────────────

  private async sendVerificationEmail(
    email: string,
    name: string | null | undefined,
    rawToken: string,
  ): Promise<void> {
    const webUrl =
      this.config.get<string>('webAppUrl') ?? 'http://localhost:3000';
    const link = `${webUrl}/cuenta/verificar-email?token=${rawToken}&email=${encodeURIComponent(email)}`;

    const apiKey = this.config.get<string>('resend.apiKey');
    if (!apiKey) {
      // Sin RESEND_API_KEY: loguea el link para poder verificar manualmente.
      this.logger.warn(
        `[EMAIL NOT SENT — configure RESEND_API_KEY] Verify link for ${email}: ${link}`,
      );
      return;
    }

    // Resend disponible: importar dinámicamente para no fallar si la key no está.
    const { Resend } = await import('resend');
    const resend = new Resend(apiKey);
    const from =
      this.config.get<string>('resend.from') ?? 'noreply@example.com';
    const greeting = name ? `Hola ${name}` : 'Hola';

    await resend.emails.send({
      from,
      to: email,
      subject: 'Activa tu cuenta',
      html: `
        <p>${greeting},</p>
        <p>Haz clic en el siguiente enlace para verificar tu correo.
           El enlace vence en 24 horas.</p>
        <p><a href="${link}">Verificar mi correo</a></p>
        <p>Si no creaste esta cuenta, ignora este mensaje.</p>
      `,
    });
  }
}
