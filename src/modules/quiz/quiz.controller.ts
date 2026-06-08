import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import type { CurrentTenantData } from '../../common/decorators/current-tenant.decorator';
import { QuizService } from './quiz.service';
import { QuizAnswersDto } from './dto/quiz-answers.dto';

@ApiTags('quiz')
@Controller('v1/quiz')
@UseGuards(TenantGuard)
@Public()
export class QuizController {
  constructor(private readonly quiz: QuizService) {}

  @Post('recommend')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Productos recomendados según el quiz' })
  recommend(
    @CurrentTenant() tenant: CurrentTenantData,
    @Body() answers: QuizAnswersDto,
  ) {
    return this.quiz.recommend(tenant.id, answers);
  }
}
