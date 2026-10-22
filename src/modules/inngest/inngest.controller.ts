import { All, Controller, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { serve } from 'inngest/express';
import { Public } from '../../common/decorators/public.decorator';
import { inngest, inngestFunctions } from './inngest.client';
import { SubscriptionRenewalService } from '../subscriptions/subscription-renewal.service';
import { createRenewSubscriptionsFunction } from './subscriptions-inngest';

@ApiExcludeController()
@Controller('jobs')
export class InngestController {
  private readonly handler;

  constructor(renewalService: SubscriptionRenewalService) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    this.handler = serve({
      client: inngest,
      functions: [
        ...inngestFunctions,
        createRenewSubscriptionsFunction(renewalService),
      ],
    });
  }

  @All()
  @Public()
  async handle(@Req() req: Request, @Res() res: Response) {
    await (this.handler as (r: Request, s: Response) => Promise<unknown>)(
      req,
      res,
    );
  }
}
