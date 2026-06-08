import { SetMetadata } from '@nestjs/common';
import type { OperatorRole } from '@prisma/client';

export const ROLES_KEY = 'roles';

/** Exige uno de los roles de operador indicados (evaluado por RolesGuard). */
export const Roles = (...roles: OperatorRole[]) => SetMetadata(ROLES_KEY, roles);
