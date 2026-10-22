import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class TurnstileService {
  private readonly logger = new Logger(TurnstileService.name);
  private readonly secretKey: string;

  constructor(private readonly config: ConfigService) {
    this.secretKey = this.config.get<string>('turnstile.secretKey') ?? '';
  }

  /**
   * Valida el token emitido por el widget de Cloudflare Turnstile en el frontend.
   * Si TURNSTILE_SECRET_KEY no está configurado (ej. desarrollo local), permite el paso
   * para no bloquear la experiencia de desarrollo.
   */
  async verifyToken(
    token?: string | null,
    clientIp?: string | null,
  ): Promise<boolean> {
    if (!this.secretKey) {
      // Entornos sin Turnstile configurado (dev/test/staging previo a Cloudflare)
      return true;
    }

    if (!token || !token.trim()) {
      throw new BadRequestException(
        'Falta el token de verificación de Cloudflare Turnstile',
      );
    }

    try {
      const formData = new URLSearchParams();
      formData.append('secret', this.secretKey);
      formData.append('response', token.trim());
      if (clientIp) {
        formData.append('remoteip', clientIp);
      }

      const res = await fetch(
        'https://challenges.cloudflare.com/turnstile/v0/siteverify',
        {
          method: 'POST',
          body: formData,
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        },
      );

      if (!res.ok) {
        this.logger.warn(`Turnstile HTTP error: ${res.status}`);
        throw new BadRequestException(
          'Error comunicándose con el servicio de verificación de Cloudflare',
        );
      }

      const data = (await res.json()) as {
        success: boolean;
        'error-codes'?: string[];
      };

      if (!data.success) {
        this.logger.warn(
          `Validación Turnstile fallida: ${data['error-codes']?.join(', ') ?? 'código desconocido'}`,
        );
        throw new BadRequestException(
          'La verificación de seguridad de Cloudflare ha fallado',
        );
      }

      return true;
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.error('Error al validar token de Turnstile', err);
      throw new BadRequestException(
        'Error inesperado al validar la seguridad del formulario',
      );
    }
  }
}

