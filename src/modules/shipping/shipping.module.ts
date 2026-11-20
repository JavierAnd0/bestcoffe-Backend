import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AdminShippingController,
  EnviaConnectController,
  EnviaWebhookController,
} from './shipping.controller';
import {
  ENVIA_CLIENT_FACTORY,
  EnviaAccountService,
  type EnviaClientFactory,
} from './envia-account.service';
import { EnviaClient } from './envia.client';
import { ShippingService } from './shipping.service';

@Module({
  controllers: [
    EnviaConnectController,
    AdminShippingController,
    EnviaWebhookController,
  ],
  providers: [
    {
      provide: ENVIA_CLIENT_FACTORY,
      // ENVIA_API_URL / ENVIA_QUERIES_URL solo para desarrollo: apuntan a un
      // Envia simulado. En producción no se definen y se usa Envia real.
      useFactory: (config: ConfigService): EnviaClientFactory => {
        const overrides = {
          shipBase: config.get<string>('ENVIA_API_URL') || undefined,
          queriesBase: config.get<string>('ENVIA_QUERIES_URL') || undefined,
        };
        return (token, test) => new EnviaClient(token, test, fetch, overrides);
      },
      inject: [ConfigService],
    },
    EnviaAccountService,
    ShippingService,
  ],
  exports: [ShippingService],
})
export class ShippingModule {}
