import { Module } from '@nestjs/common';
import { EpaycoController } from './epayco.controller';
import { EpaycoConnectController } from './epayco-connect.controller';
import { EpaycoService } from './epayco.service';

@Module({
  controllers: [EpaycoController, EpaycoConnectController],
  providers: [EpaycoService],
  exports: [EpaycoService],
})
export class EpaycoModule {}
