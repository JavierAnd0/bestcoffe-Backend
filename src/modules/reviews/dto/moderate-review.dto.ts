import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class ApproveReviewDto {
  @ApiPropertyOptional({ description: 'Marcar como suscriptor verificado' })
  @IsOptional()
  @IsBoolean()
  verifiedSubscriber?: boolean;
}

export class ReplyReviewDto {
  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reply?: string;
}
