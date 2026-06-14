import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class VerifyEmailDto {
  @ApiProperty({ description: 'Token recibido por correo' })
  @IsString()
  @IsNotEmpty()
  token!: string;

  @ApiProperty({ example: 'ana@ejemplo.co' })
  @IsEmail()
  email!: string;
}
