import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class RegisterCustomerDto {
  @ApiProperty({ example: 'ana@ejemplo.co' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'MiClave123', minLength: 8 })
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiPropertyOptional({ example: 'Ana García' })
  @IsString()
  @IsOptional()
  name?: string;
}
