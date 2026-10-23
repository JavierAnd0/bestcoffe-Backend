import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';

@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected override getTracker(req: Record<string, unknown>): Promise<string> {
    const request = req as unknown as Request;

    // 1. Cloudflare header prioritario: 'cf-connecting-ip'
    const cfIp = request.headers['cf-connecting-ip'];
    if (typeof cfIp === 'string' && cfIp.trim()) {
      return Promise.resolve(cfIp.trim());
    }

    // 2. Cabecera estándar de proxy: 'x-forwarded-for' (primer IP del cliente)
    const xForwardedFor = request.headers['x-forwarded-for'];
    if (typeof xForwardedFor === 'string' && xForwardedFor.trim()) {
      const firstIp = xForwardedFor.split(',')[0]?.trim();
      if (firstIp) return Promise.resolve(firstIp);
    }

    // 3. Fallback a Express req.ips / req.ip / remoteAddress
    const resolvedIp =
      (Array.isArray(request.ips) && request.ips.length > 0
        ? request.ips[0]
        : undefined) ??
      request.ip ??
      request.socket?.remoteAddress ??
      '127.0.0.1';

    return Promise.resolve(resolvedIp);
  }

  protected override getErrorMessage(): Promise<string> {
    return Promise.resolve(
      'Has superado el límite de peticiones permitido. Por favor espera unos momentos antes de reintentar.',
    );
  }
}
