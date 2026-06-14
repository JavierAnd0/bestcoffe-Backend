import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class CustomerLoginDto {
  @ApiProperty({ example: 'ana@ejemplo.co' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'MiClave123' })
  @IsString()
  @IsNotEmpty()
  password!: string;
}
