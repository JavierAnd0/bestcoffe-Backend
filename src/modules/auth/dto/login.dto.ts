import { ApiProperty } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'operador@origen.co' })
  @IsEmail()
  email!: string;
}
