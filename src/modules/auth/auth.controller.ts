import {
  Body,
  Controller,
  Get,
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

@ApiTags('auth')
@Controller('v1/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly turnstile: TurnstileService,
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

  @Get('me')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  me(@CurrentUser() user: CurrentUserData) {
    return this.auth.getMe(user);
  }
}
