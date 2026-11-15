import { Controller, Get, NotFoundException, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { TenantDomainsService } from './tenant-domains.service';

/**
 * Resolución pública dominio → tienda. La usa el proxy del front cuando recibe
 * una visita en un host que no es un subdominio de la plataforma. Solo responde
 * con dominios VERIFICADOS; para el resto, 404.
 */
@ApiTags('tenants')
@Controller('v1/tenant-domains')
@Public()
export class TenantDomainsController {
  constructor(private readonly domains: TenantDomainsService) {}

  @Get('resolve')
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  async resolve(@Query('host') host?: string) {
    const slug = host ? await this.domains.resolveSlug(host) : null;
    if (!slug) throw new NotFoundException('Dominio no registrado');
    return { slug };
  }
}
