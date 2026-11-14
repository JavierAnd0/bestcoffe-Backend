import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { FeatureGuard } from '../../common/guards/feature.guard';
import { InternalSecretGuard } from '../../common/guards/internal-secret.guard';
import { RequireFeature } from '../../common/decorators/require-feature.decorator';
import { CUSTOMER_COOKIE } from '../../common/guards/customer-auth.guard';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import type { CurrentTenantData } from '../../common/decorators/current-tenant.decorator';
import { TurnstileService } from '../../common/services/turnstile.service';
import { CustomerAuthService } from './customer-auth.service';
import { RegisterCustomerDto } from './dto/register-customer.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { CustomerLoginDto } from './dto/customer-login.dto';
import { SyncNeonCustomerDto } from './dto/sync-neon-customer.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

const COOKIE_OPTIONS = (isProd: boolean) =>
  ({
    httpOnly: true,
    secure: isProd,
    // 'none' en prod para cross-origin (front y API en dominios distintos).
    // 'lax'  en dev (localhost no admite sameSite=none sin HTTPS).
    sameSite: isProd ? 'none' : 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 días en ms
    path: '/',
  }) as const;

@ApiTags('customer-auth')
@Controller('v1/auth/customer')
export class CustomerAuthController {
  private readonly isProd = process.env.NODE_ENV === 'production';

  constructor(
    private readonly customerAuth: CustomerAuthService,
    private readonly turnstile: TurnstileService,
  ) {}

  /** Crea la cuenta y envía el correo de verificación. */
  @Post('register')
  @Public()
  @UseGuards(TenantGuard, FeatureGuard)
  @RequireFeature('customerAccounts')
  @Throttle({ default: { limit: 3, ttl: 300_000 } })
  async register(
    @CurrentTenant() tenant: CurrentTenantData,
    @Body() dto: RegisterCustomerDto,
    @Req() req: Request,
  ) {
    await this.turnstile.verifyToken(dto.turnstileToken, req.ip);
    return this.customerAuth.register(tenant.id, dto);
  }

  /**
   * Verifica el token del correo, activa la cuenta y establece la cookie de sesión.
   * No requiere X-Tenant-Slug: el token identifica al cliente de forma única.
   */
  @Post('verify-email')
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async verifyEmail(
    @Body() dto: VerifyEmailDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.customerAuth.verifyEmail(dto);
    this.setSessionCookie(res, result.accessToken);
    return { customer: result.customer };
  }

  /** Login con email + contraseña. Requiere email verificado. */
  @Post('login')
  @Public()
  @UseGuards(TenantGuard, FeatureGuard)
  @RequireFeature('customerAccounts')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async login(
    @CurrentTenant() tenant: CurrentTenantData,
    @Body() dto: CustomerLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.turnstile.verifyToken(dto.turnstileToken, req.ip);
    const result = await this.customerAuth.login(tenant.id, dto);
    this.setSessionCookie(res, result.accessToken);
    return { customer: result.customer };
  }

  /** Solicita un enlace por correo para restablecer la contraseña olvidada. */
  @Post('forgot-password')
  @Public()
  @HttpCode(200)
  @UseGuards(TenantGuard, FeatureGuard)
  @RequireFeature('customerAccounts')
  @Throttle({ default: { limit: 3, ttl: 300_000 } })
  async forgotPassword(
    @CurrentTenant() tenant: CurrentTenantData,
    @Body() dto: ForgotPasswordDto,
    @Req() req: Request,
  ) {
    await this.turnstile.verifyToken(dto.turnstileToken, req.ip);
    return this.customerAuth.forgotPassword(tenant.id, dto);
  }

  /** Restablece la contraseña usando el token enviado por correo. */
  @Post('reset-password')
  @Public()
  @HttpCode(200)
  @UseGuards(TenantGuard, FeatureGuard)
  @RequireFeature('customerAccounts')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  resetPassword(
    @CurrentTenant() tenant: CurrentTenantData,
    @Body() dto: ResetPasswordDto,
  ) {
    return this.customerAuth.resetPassword(tenant.id, dto);
  }

  /**
   * Sincroniza la sesión con el backend tras iniciar sesión en el frontend vía Neon Auth (Google / OTP).
   * Genera el Customer en la base de datos de la tienda si no existe y emite la cookie de sesión.
   * Protegido por InternalSecretGuard (`x-internal-secret` / `x-revalidate-secret`).
   */
  @Post('neon-sync')
  @Public()
  @UseGuards(TenantGuard, FeatureGuard, InternalSecretGuard)
  @RequireFeature('customerAccounts')
  @ApiHeader({
    name: 'x-internal-secret',
    description: 'Secreto compartido (REVALIDATE_SECRET) entre front y API',
    required: true,
  })
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async syncNeon(
    @CurrentTenant() tenant: CurrentTenantData,
    @Body() dto: SyncNeonCustomerDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.customerAuth.syncNeonCustomer(tenant.id, dto);
    this.setSessionCookie(res, result.accessToken);
    return { customer: result.customer, accessToken: result.accessToken };
  }

  /** Cierra la sesión eliminando la cookie. */
  @Post('logout')
  @Public()
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(CUSTOMER_COOKIE, { path: '/' });
    return { message: 'Sesión cerrada' };
  }

  private setSessionCookie(res: Response, token: string) {
    res.cookie(CUSTOMER_COOKIE, token, COOKIE_OPTIONS(this.isProd));
  }
}
