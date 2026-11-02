import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CustomerLoginDto {
  @ApiProperty({ example: 'ana@ejemplo.co' })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: 'MiClave123', maxLength: 128 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password!: string;

  @ApiPropertyOptional({
    description: 'Token de verificación emitido por Cloudflare Turnstile',
  })
  @IsOptional()
  @IsString()
  turnstileToken?: string;
}
