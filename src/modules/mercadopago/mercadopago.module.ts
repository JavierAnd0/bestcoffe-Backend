import { Module } from '@nestjs/common';
import { MercadoPagoController } from './mercadopago.controller';
import { MercadoPagoConnectController } from './mercadopago-connect.controller';
import { MercadoPagoService } from './mercadopago.service';

@Module({
  controllers: [MercadoPagoController, MercadoPagoConnectController],
  providers: [MercadoPagoService],
  exports: [MercadoPagoService],
})
export class MercadoPagoModule {}
