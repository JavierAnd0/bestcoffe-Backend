import { Global, Module } from '@nestjs/common';
import { RevalidationService } from './revalidation.service';

/** Global: cualquier módulo admin lo inyecta para revalidar el front. */
@Global()
@Module({
  providers: [RevalidationService],
  exports: [RevalidationService],
})
export class RevalidationModule {}
