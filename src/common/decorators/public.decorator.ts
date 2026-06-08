import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Marca una ruta como pública (sin AuthGuard). El TenantGuard sigue aplicando. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
