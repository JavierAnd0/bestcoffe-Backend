import { Body, Controller, Post, Res, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { CUSTOMER_COOKIE } from '../../common/guards/customer-auth.guard';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import type { CurrentTenantData } from '../../common/decorators/current-tenant.decorator';
import { CustomerAuthService } from './customer-auth.service';
import { RegisterCustomerDto } from './dto/register-customer.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { CustomerLoginDto } from './dto/customer-login.dto';

const COOKIE_OPTIONS = (isProd: boolean) =>
  ({
    httpOnly: true,
    secure: isProd,
    // 'none' en prod para cross-origin (front y API en dominios distintos).
    // 'lax'  en dev (localhost no admite sameSite=none sin HTTPS).
    sameSite: (isProd ? 'none' : 'lax') as 'none' | 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 días en ms
    path: '/',
  }) as const;

@ApiTags('customer-auth')
@Controller('v1/auth/customer')
export class CustomerAuthController {
  private readonly isProd = process.env.NODE_ENV === 'production';

  constructor(private readonly customerAuth: CustomerAuthService) {}

  /** Crea la cuenta y envía el correo de verificación. */
  @Post('register')
  @Public()
  @UseGuards(TenantGuard)
  register(
    @CurrentTenant() tenant: CurrentTenantData,
    @Body() dto: RegisterCustomerDto,
  ) {
    return this.customerAuth.register(tenant.id, dto);
  }

  /**
   * Verifica el token del correo, activa la cuenta y establece la cookie de sesión.
   * No requiere X-Tenant-Slug: el token identifica al cliente de forma única.
   */
  @Post('verify-email')
  @Public()
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
  @UseGuards(TenantGuard)
  async login(
    @CurrentTenant() tenant: CurrentTenantData,
    @Body() dto: CustomerLoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.customerAuth.login(tenant.id, dto);
    this.setSessionCookie(res, result.accessToken);
    return { customer: result.customer };
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
