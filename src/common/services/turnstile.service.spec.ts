import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TurnstileService } from './turnstile.service';

describe('TurnstileService', () => {
  it('debe permitir la solicitud si TURNSTILE_SECRET_KEY no está configurado (modo dev/fallback)', async () => {
    const configService = {
      get: jest.fn().mockReturnValue(''),
    } as unknown as ConfigService;

    const service = new TurnstileService(configService);
    const result = await service.verifyToken(undefined);

    expect(result).toBe(true);
  });

  it('debe lanzar BadRequestException si está configurado pero falta el token', async () => {
    const configService = {
      get: jest.fn().mockReturnValue('0x4AAAAAASecretKeyDemo'),
    } as unknown as ConfigService;

    const service = new TurnstileService(configService);

    await expect(service.verifyToken('')).rejects.toThrow(BadRequestException);
    await expect(service.verifyToken(null)).rejects.toThrow(
      BadRequestException,
    );
  });
});
