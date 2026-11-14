import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

export class ForgotPasswordDto {
  @ApiProperty({ example: 'ana@ejemplo.co' })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiPropertyOptional({
    description: 'Token de verificación emitido por Cloudflare Turnstile',
  })
  @IsOptional()
  @IsString()
  turnstileToken?: string;
}
