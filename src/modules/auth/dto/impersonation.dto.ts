import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class ImpersonationDto {
  @ApiProperty({
    description: 'Pase emitido por POST /v1/platform/tenants/:id/impersonate',
  })
  @IsString()
  @MaxLength(2048)
  token!: string;
}
