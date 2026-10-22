import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { PrismaService } from '../../prisma/prisma.service';

interface RequestWithAudit extends Request {
  tenantId?: string;
  user?: { id: string };
}

/**
 * Escribe AuditLog automáticamente para cada mutación admin exitosa
 * (POST/PATCH/PUT/DELETE bajo /v1/admin). No confiar en llamadas explícitas.
 * El `diff` guarda el body enviado; en fases siguientes se enriquece con el
 * antes/después real por entidad.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);
  private static readonly MUTATIONS = new Set([
    'POST',
    'PATCH',
    'PUT',
    'DELETE',
  ]);

  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<RequestWithAudit>();
    const method: string = req.method;
    const url: string = req.originalUrl ?? req.url ?? '';
    const shouldAudit =
      AuditInterceptor.MUTATIONS.has(method) && url.includes('/admin');

    return next.handle().pipe(
      tap((result) => {
        if (!shouldAudit) return;
        const tenantId: string | undefined = req.tenantId;
        const userId: string | undefined = req.user?.id;
        if (!tenantId || !userId) return;

        const entity = this.entityFromUrl(url);
        let entityId = 'unknown';
        if (result && typeof result === 'object' && 'id' in result) {
          const val = (result as { id: unknown }).id;
          if (typeof val === 'string' || typeof val === 'number') {
            entityId = String(val);
          }
        } else if (req.params?.id) {
          entityId = Array.isArray(req.params.id)
            ? (req.params.id[0] ?? 'unknown')
            : req.params.id;
        }

        // fire-and-forget: no bloquear la respuesta por la auditoría
        this.prisma.auditLog
          .create({
            data: {
              tenantId,
              userId,
              action: method,
              entity,
              entityId,
              diff: this.safeBody(req.body),
            },
          })
          .catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            this.logger.warn(`No se pudo escribir AuditLog: ${msg}`);
          });
      }),
    );
  }

  private entityFromUrl(url: string): string {
    // /v1/admin/products/123 → "products"
    const parts = url.split('?')[0].split('/').filter(Boolean);
    const adminIdx = parts.indexOf('admin');
    return adminIdx >= 0 && parts[adminIdx + 1]
      ? parts[adminIdx + 1]
      : 'unknown';
  }

  private safeBody(body: unknown): object {
    if (!body || typeof body !== 'object') return {};
    const redacted = { ...(body as Record<string, unknown>) };
    for (const k of ['password', 'token', 'secret']) delete redacted[k];
    return redacted;
  }
}
