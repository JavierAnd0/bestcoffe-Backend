import { Global, Module } from '@nestjs/common';
import { MailService } from './mail.service';

/**
 * Módulo global de correo: cualquier servicio puede inyectar MailService sin
 * importar el módulo explícitamente.
 */
@Global()
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
