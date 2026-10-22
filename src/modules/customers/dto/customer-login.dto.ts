import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

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
}
