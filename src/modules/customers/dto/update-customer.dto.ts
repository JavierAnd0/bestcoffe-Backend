import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';

/** Datos editables por el propio cliente desde "Mis datos". */
export class UpdateCustomerDto {
  @ApiPropertyOptional({ description: 'Nombre completo' })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  @ApiPropertyOptional({ description: 'Teléfono de contacto' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @ApiPropertyOptional({
    description:
      'Recibir novedades, promociones y guías por correo. Los correos de pedidos y envíos no dependen de esta preferencia.',
  })
  @IsOptional()
  @IsBoolean()
  newsletterOptIn?: boolean;
}
