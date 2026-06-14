import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import type { CurrentTenantData } from '../../common/decorators/current-tenant.decorator';
import { CustomerAuthService } from './customer-auth.service';
import { RegisterCustomerDto } from './dto/register-customer.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { CustomerLoginDto } from './dto/customer-login.dto';

@ApiTags('customer-auth')
@Controller('v1/auth/customer')
export class CustomerAuthController {
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
   * Verifica el correo con el token enviado por email.
   * No requiere X-Tenant-Slug: el token identifica al cliente de forma única.
   */
  @Post('verify-email')
  @Public()
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.customerAuth.verifyEmail(dto);
  }

  /** Inicia sesión con email + contraseña. Requiere email verificado. */
  @Post('login')
  @Public()
  @UseGuards(TenantGuard)
  login(
    @CurrentTenant() tenant: CurrentTenantData,
    @Body() dto: CustomerLoginDto,
  ) {
    return this.customerAuth.login(tenant.id, dto);
  }
}
