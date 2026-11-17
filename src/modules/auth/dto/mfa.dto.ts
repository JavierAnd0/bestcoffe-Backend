import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

/** Código de la app autenticadora (6 dígitos) o de respaldo (abcd-efgh). */
export class MfaCodeDto {
  @ApiProperty({ example: '123456' })
  @IsString()
  @MinLength(6)
  @MaxLength(20)
  code!: string;
}

export class VerifyMfaDto extends MfaCodeDto {
  @ApiProperty({ description: 'Token del paso pendiente que devolvió /verify' })
  @IsString()
  @MaxLength(2048)
  mfaToken!: string;
}
