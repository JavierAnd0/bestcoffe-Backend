import { All, Controller, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { serve } from 'inngest/express';
import { Public } from '../../common/decorators/public.decorator';
import { inngest, inngestFunctions } from './inngest.client';

/**
 * Monta el handler de Inngest en /jobs (GET para introspección, PUT para
 * registro, POST para invocación). Inngest verifica su propia firma.
 */
@ApiExcludeController()
@Controller('jobs')
export class InngestController {
  // signingKey se lee de INNGEST_SIGNING_KEY del entorno automáticamente.
  private readonly handler = serve({
    client: inngest,
    functions: inngestFunctions,
  });

  @All()
  @Public()
  handle(@Req() req: Request, @Res() res: Response) {
    return this.handler(req, res);
  }
}
