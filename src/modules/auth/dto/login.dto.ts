import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, MaxLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'operador@origen.co' })
  @IsEmail()
  @MaxLength(254)
  email!: string;
}
