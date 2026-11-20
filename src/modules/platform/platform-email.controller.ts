import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PlatformGuard } from '../../common/guards/platform.guard';
import { EmailUsageService } from './email-usage.service';

@ApiTags('platform')
@ApiBearerAuth()
@Controller('v1/platform/email-usage')
@UseGuards(PlatformGuard)
export class PlatformEmailController {
  constructor(private readonly usage: EmailUsageService) {}

  /** Correos enviados hoy y este mes frente al cupo del plan de Resend. */
  @Get()
  get() {
    return this.usage.getUsage();
  }
}
