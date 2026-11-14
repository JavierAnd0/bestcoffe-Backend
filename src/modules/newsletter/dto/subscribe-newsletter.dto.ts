import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

export const NEWSLETTER_SOURCES = ['popup', 'footer'] as const;

export class SubscribeNewsletterDto {
  @ApiProperty({ example: 'cliente@correo.com' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: 'Ingresa un correo electrónico válido' })
  @MaxLength(254)
  email!: string;

  @ApiPropertyOptional({ enum: NEWSLETTER_SOURCES })
  @IsOptional()
  @IsIn(NEWSLETTER_SOURCES)
  source?: (typeof NEWSLETTER_SOURCES)[number];
}
