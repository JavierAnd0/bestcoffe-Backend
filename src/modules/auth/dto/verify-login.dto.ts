import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString } from 'class-validator';

export class VerifyLoginDto {
  @ApiProperty({ example: 'operador@origen.co' })
  @IsEmail()
  email!: string;

  @ApiProperty({ description: 'Token raw recibido en el enlace de acceso' })
  @IsString()
  token!: string;
}
