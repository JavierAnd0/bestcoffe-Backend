import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { verifyClientIp } from '../crypto/client-ip-signature';

/** Secreto compartido con el front (el mismo de las llamadas internas). */
const sharedSecret = () => process.env.REVALIDATE_SECRET ?? '';

/**
 * Resuelve la IP del cliente para el rate-limiting.
 *
 * IMPORTANTE: 'cf-connecting-ip' y 'x-forwarded-for' son cabeceras que
 * CUALQUIER cliente puede falsificar si la petición llega directo al
 * proceso Node (sin pasar por un proxy de confianza que las reescriba).
 * Solo deben confiarse cuando el tráfico público está forzado a pasar por
 * ese proxy (Cloudflare / balanceador) y Express tiene `trust proxy`
 * configurado acorde — ver `app.set('trust proxy', 1)` en main.ts, que le
 * dice a Express cuántos saltos de proxy confiar para poblar `req.ips`.
 *
 * Por eso aquí NO se usa 'cf-connecting-ip' como fuente primaria de forma
 * incondicional: se prioriza `req.ips`/`req.ip`, que Express ya calculó
 * respetando `trust proxy`, y solo se cae a las cabeceras crudas como
 * último recurso informativo.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  /**
   * Lecturas del servidor del front sin visitante (render en segundo plano,
   * caché de datos), firmadas con el secreto compartido: no cuentan contra
   * ningún límite. Sin esto, todas compartirían el cupo de la IP del servidor
   * de Next. Las escrituras nunca se saltan el límite.
   */
  protected override async shouldSkip(
    context: ExecutionContext,
  ): Promise<boolean> {
    if (await super.shouldSkip(context)) return true;
    const req = context.switchToHttp().getRequest<Request>();
    if (!req?.headers || req.method !== 'GET') return false;
    const v = verifyClientIp(sharedSecret(), req.headers);
    return v.valid && v.ip === '';
  }

  protected override getTracker(req: Record<string, unknown>): Promise<string> {
    const request = req as unknown as Request;

    // 0. IP del visitante reenviada y firmada por el servidor del front: es la
    //    única forma de distinguir visitantes cuyas peticiones llegan todas
    //    desde el servidor de Next. Sin firma válida, se ignora.
    if (request.headers) {
      const v = verifyClientIp(sharedSecret(), request.headers);
      if (v.valid && v.ip) return Promise.resolve(v.ip);
    }

    // 1. Express ya resuelve la IP real del cliente respetando `trust proxy`
    //    (configurado en main.ts para confiar en 1 salto de proxy inverso).
    //    Esta es la fuente confiable principal.
    const resolvedIp =
      (Array.isArray(request.ips) && request.ips.length > 0
        ? request.ips[0]
        : undefined) ?? request.ip;
    if (resolvedIp) {
      return Promise.resolve(resolvedIp);
    }

    // 2. Cabecera estándar de proxy: 'x-forwarded-for' (primer IP del cliente).
    //    Solo es fiable si trust proxy está bien configurado; se usa como
    //    fallback cuando Express no pudo resolver req.ip/req.ips.
    const xForwardedFor = request.headers['x-forwarded-for'];
    if (typeof xForwardedFor === 'string' && xForwardedFor.trim()) {
      const firstIp = xForwardedFor.split(',')[0]?.trim();
      if (firstIp) return Promise.resolve(firstIp);
    }

    // 3. Cloudflare header, último recurso: NO se prioriza sobre lo anterior
    //    porque es falsificable si la petición no pasó realmente por
    //    Cloudflare. Solo es segura detrás de un proxy de confianza que la
    //    sobrescriba/valide antes de llegar a este proceso.
    const cfIp = request.headers['cf-connecting-ip'];
    if (typeof cfIp === 'string' && cfIp.trim()) {
      return Promise.resolve(cfIp.trim());
    }

    // 4. Último fallback: socket remoto directo.
    return Promise.resolve(request.socket?.remoteAddress ?? '127.0.0.1');
  }

  protected override getErrorMessage(): Promise<string> {
    return Promise.resolve(
      'Has superado el límite de peticiones permitido. Por favor espera unos momentos antes de reintentar.',
    );
  }
}
