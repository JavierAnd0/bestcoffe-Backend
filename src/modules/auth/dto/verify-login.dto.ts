import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength } from 'class-validator';

export class VerifyLoginDto {
  @ApiProperty({ example: 'operador@origen.co' })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ description: 'Token raw recibido en el enlace de acceso' })
  @IsString()
  @MaxLength(128)
  token!: string;
}
