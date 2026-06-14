import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import {
  createHash,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Resend } from 'resend';
import { PrismaService } from '../../prisma/prisma.service';
import type { RegisterCustomerDto } from './dto/register-customer.dto';
import type { VerifyEmailDto } from './dto/verify-email.dto';
import type { CustomerLoginDto } from './dto/customer-login.dto';
import type { CustomerJwtPayload } from '../../common/guards/customer-auth.guard';

const scryptAsync = promisify(scrypt);

const SCRYPT_KEYLEN = 64;
const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 h

@Injectable()
export class CustomerAuthService {
  private readonly resend: Resend;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {
    this.resend = new Resend(this.config.get<string>('resend.apiKey'));
  }

  // ─── Register ────────────────────────────────────────────────────────────

  async register(tenantId: string, dto: RegisterCustomerDto) {
    const existing = await this.prisma.customer.findUnique({
      where: { tenantId_email: { tenantId, email: dto.email } },
    });
    if (existing) {
      throw new ConflictException('Ya existe una cuenta con ese correo');
    }

    const passwordHash = await this.hashPassword(dto.password);
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

    const accessToken = await this.signToken(customer.id, customer.email, customer.tenantId);
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

    if (!customer || !customer.passwordHash) {
      // Misma respuesta para correo inexistente y sin contraseña (evita enumerar cuentas).
      throw new UnauthorizedException('Correo o contraseña incorrectos');
    }

    if (!customer.emailVerified) {
      throw new UnauthorizedException(
        'Debes verificar tu correo antes de iniciar sesión. Revisa tu bandeja de entrada.',
      );
    }

    const passwordOk = await this.verifyPassword(dto.password, customer.passwordHash);
    if (!passwordOk) {
      throw new UnauthorizedException('Correo o contraseña incorrectos');
    }

    const accessToken = await this.signToken(customer.id, customer.email, customer.tenantId);
    return {
      accessToken,
      customer: { id: customer.id, email: customer.email, name: customer.name },
    };
  }

  // ─── Crypto helpers ──────────────────────────────────────────────────────

  private async hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16).toString('hex');
    const derived = (await scryptAsync(password, salt, SCRYPT_KEYLEN)) as Buffer;
    return `${salt}:${derived.toString('hex')}`;
  }

  private async verifyPassword(password: string, stored: string): Promise<boolean> {
    const [salt, hash] = stored.split(':');
    if (!salt || !hash) return false;
    const derived = (await scryptAsync(password, salt, SCRYPT_KEYLEN)) as Buffer;
    const storedBuf = Buffer.from(hash, 'hex');
    return derived.length === storedBuf.length && timingSafeEqual(derived, storedBuf);
  }

  private generateVerifyToken(): { rawToken: string; hashedToken: string } {
    const rawToken = randomBytes(32).toString('hex');
    return { rawToken, hashedToken: this.hashToken(rawToken) };
  }

  private hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  private signToken(customerId: string, email: string, tenantId: string): Promise<string> {
    const payload: CustomerJwtPayload = {
      sub: customerId,
      email,
      tenantId,
      type: 'customer',
    };
    return this.jwt.signAsync(payload);
  }

  // ─── Email ───────────────────────────────────────────────────────────────

  private async sendVerificationEmail(
    email: string,
    name: string | null | undefined,
    rawToken: string,
  ): Promise<void> {
    const webUrl = this.config.get<string>('webAppUrl') ?? 'http://localhost:3000';
    const link = `${webUrl}/cuenta/verificar-email?token=${rawToken}&email=${encodeURIComponent(email)}`;
    const from = this.config.get<string>('resend.from') ?? 'noreply@example.com';
    const greeting = name ? `Hola ${name}` : 'Hola';

    await this.resend.emails.send({
      from,
      to: email,
      subject: 'Activa tu cuenta',
      html: `
        <p>${greeting},</p>
        <p>Haz clic en el siguiente enlace para verificar tu correo y activar tu cuenta.
           El enlace vence en 24 horas.</p>
        <p><a href="${link}" style="font-weight:bold">Verificar mi correo</a></p>
        <p>Si no creaste esta cuenta, ignora este mensaje.</p>
      `,
    });
  }
}
