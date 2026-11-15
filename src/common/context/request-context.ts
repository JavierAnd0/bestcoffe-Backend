import type { OperatorRole } from '@prisma/client';

/**
 * Claves del store CLS (AsyncLocalStorage) que viajan por todo el request.
 * Las pueblan TenantGuard / AuthGuard y las consume cualquier servicio.
 */
export const CTX = {
  TENANT_ID: 'tenantId',
  TENANT_SLUG: 'tenantSlug',
  USER_ID: 'userId',
  ROLE: 'role',
  REQUEST_ID: 'requestId',
  /** Cabecera `X-Demo-Features` cruda (solo la honra una tienda sandbox). */
  DEMO_FEATURES: 'demoFeatures',
} as const;

export interface RequestContextStore {
  [CTX.TENANT_ID]?: string;
  [CTX.TENANT_SLUG]?: string;
  [CTX.USER_ID]?: string;
  [CTX.ROLE]?: OperatorRole;
  [CTX.REQUEST_ID]?: string;
  [CTX.DEMO_FEATURES]?: string;
}
