import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString } from 'class-validator';

export class SyncNeonCustomerDto {
  @ApiProperty({ example: 'usuario@gmail.com' })
  @IsEmail()
  email!: string;

  @ApiPropertyOptional({ example: 'Juan Pérez' })
  @IsOptional()
  @IsString()
  name?: string;
}
