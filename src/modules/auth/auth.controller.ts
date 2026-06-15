import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../../common/guards/auth.guard';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { CurrentUserData } from '../../common/decorators/current-user.decorator';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { VerifyLoginDto } from './dto/verify-login.dto';

@ApiTags('auth')
@Controller('v1/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Paso 1: solicita el enlace de acceso (magic link) por correo. */
  @Post('login')
  @Public()
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.auth.requestMagicLink(dto.email);
  }

  /** Paso 2: canjea el token del enlace por un JWT de operador. */
  @Post('verify')
  @Public()
  @HttpCode(200)
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
