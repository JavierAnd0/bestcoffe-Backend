import {
  All,
  Body,
  Controller,
  HttpCode,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { InternalSecretGuard } from '../../common/guards/internal-secret.guard';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import type { CurrentTenantData } from '../../common/decorators/current-tenant.decorator';
import { EpaycoService } from './epayco.service';
import { SyncEpaycoPaymentDto } from './dto/sync-payment.dto';

@ApiExcludeController()
@SkipThrottle()
@Controller('v1/epayco')
export class EpaycoController {
  constructor(private readonly epayco: EpaycoService) {}

  /**
   * URL de confirmación de ePayco (servidor a servidor). ePayco la llama por
   * GET o POST y reintenta si no recibe 200. El aviso no se cree tal cual: el
   * service consulta la transacción a ePayco y valida firma, comercio, pedido
   * y monto antes de liquidar.
   */
  @All('confirmation')
  @Public()
  @HttpCode(200)
  async confirmation(
    @Query() query: Record<string, unknown>,
    @Body() body: Record<string, unknown> | undefined,
  ) {
    await this.epayco.handleConfirmation({ ...query, ...(body ?? {}) });
    return 'OK';
  }

  /**
   * Regreso del comprador: la confirmación de la tienda (servidor a servidor,
   * con el secreto interno) pide el estado real sin esperar el aviso.
   */
  @Post('sync')
  @Public()
  @UseGuards(TenantGuard, InternalSecretGuard)
  @SkipThrottle({ default: false })
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(200)
  sync(
    @CurrentTenant() tenant: CurrentTenantData,
    @Body() dto: SyncEpaycoPaymentDto,
  ) {
    return this.epayco.syncPayment(tenant.id, dto.orderId, dto.refPayco);
  }
}
