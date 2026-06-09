import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { OperatorRole } from '@prisma/client';

/**
 * Roles que un operador del tenant puede asignar. `PLATFORM_OWNER` queda fuera
 * a propósito: es un rol de plataforma, solo lo otorga la propia plataforma.
 */
export const ASSIGNABLE_ROLES: OperatorRole[] = [
  OperatorRole.TENANT_OWNER,
  OperatorRole.TENANT_EDITOR,
  OperatorRole.TENANT_ORDERS,
];

export class AddMemberDto {
  @ApiProperty({ description: 'Email del operador (se crea si no existe)' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(200)
  email!: string;

  @ApiPropertyOptional({ description: 'Nombre a mostrar (si el usuario es nuevo)' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiProperty({ enum: ASSIGNABLE_ROLES })
  @IsIn(ASSIGNABLE_ROLES, {
    message: `role debe ser uno de: ${ASSIGNABLE_ROLES.join(', ')}`,
  })
  role!: OperatorRole;
}

export class UpdateMemberRoleDto {
  @ApiProperty({ enum: ASSIGNABLE_ROLES })
  @IsIn(ASSIGNABLE_ROLES, {
    message: `role debe ser uno de: ${ASSIGNABLE_ROLES.join(', ')}`,
  })
  role!: OperatorRole;
}
