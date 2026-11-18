import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuthGuard } from '../../common/guards/auth.guard';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { CurrentUserData } from '../../common/decorators/current-user.decorator';
import { TurnstileService } from '../../common/services/turnstile.service';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { VerifyLoginDto } from './dto/verify-login.dto';
import { MfaCodeDto, VerifyMfaDto } from './dto/mfa.dto';
import { MfaService } from './mfa.service';

@ApiTags('auth')
@Controller('v1/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly turnstile: TurnstileService,
    private readonly mfa: MfaService,
  ) {}

  /** Paso 1: solicita el enlace de acceso (magic link) por correo. */
  @Post('login')
  @Public()
  @HttpCode(200)
  @Throttle({ default: { limit: 3, ttl: 300_000 } })
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    await this.turnstile.verifyToken(dto.turnstileToken, req.ip);
    return this.auth.requestMagicLink(dto.email);
  }

  /** Paso 2: canjea el token del enlace por un JWT de operador. */
  @Post('verify')
  @Public()
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  verify(@Body() dto: VerifyLoginDto) {
    return this.auth.verifyMagicLink(dto.email, dto.token);
  }

  /**
   * Operador de la sesión. Si llega `X-Tenant-Slug`, incluye `tenantRole`: su
   * rol en esa tienda (null si no es miembro). El panel lo usa para mostrar u
   * ocultar lo que es solo del dueño; la API sigue exigiendo el rol en cada ruta.
   */
  @Get('me')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  me(
    @CurrentUser() user: CurrentUserData,
    @Headers('x-tenant-slug') tenantSlug?: string,
  ) {
    return this.auth.getMe(user, tenantSlug);
  }

  /** Paso 3, solo con 2FA activo: código de la app (o de respaldo) → sesión. */
  @Post('mfa/verify')
  @Public()
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  verifyMfa(@Body() dto: VerifyMfaDto) {
    return this.auth.verifyMfa(dto.mfaToken, dto.code);
  }

  // ── Gestión del 2FA del propio operador (con sesión) ──────────────────────

  @Get('mfa')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  mfaStatus(@CurrentUser() user: CurrentUserData) {
    return this.mfa.status(user.id);
  }

  @Post('mfa/setup')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  mfaSetup(@CurrentUser() user: CurrentUserData) {
    return this.mfa.startSetup(user.id, user.email);
  }

  @Post('mfa/enable')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async mfaEnable(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: MfaCodeDto,
  ) {
    const result = await this.mfa.confirmSetup(user.id, dto.code);
    const accessToken = await this.auth.sessionAfterMfaSetup(user);
    return { ...result, accessToken };
  }

  @Post('mfa/disable')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  mfaDisable(@CurrentUser() user: CurrentUserData, @Body() dto: MfaCodeDto) {
    if (this.auth.isPlatformOwner(user.email)) {
      throw new BadRequestException(
        'La verificación en dos pasos es obligatoria para la cuenta de la plataforma.',
      );
    }
    return this.mfa.disable(user.id, dto.code);
  }

  @Post('mfa/recovery-codes')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  mfaRecoveryCodes(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: MfaCodeDto,
  ) {
    return this.mfa.regenerateRecoveryCodes(user.id, dto.code);
  }
}
