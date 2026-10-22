import { All, Controller, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { serve } from 'inngest/express';
import { Public } from '../../common/decorators/public.decorator';
import { inngest } from './inngest.client';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { SubscriptionRenewalService } from '../subscriptions/subscription-renewal.service';
import { createRenewSubscriptionsFunction } from './subscriptions-inngest';
import { createOrderConfirmationFunction } from './order-confirmation-inngest';

@ApiExcludeController()
@Controller('jobs')
export class InngestController {
  private readonly handler;

  constructor(
    renewalService: SubscriptionRenewalService,
    prisma: PrismaService,
    mail: MailService,
  ) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    this.handler = serve({
      client: inngest,
      functions: [
        createRenewSubscriptionsFunction(renewalService),
        createOrderConfirmationFunction(prisma, mail),
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
