import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from '@node-rs/argon2';
import { CustomerAuthService } from './customer-auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';

jest.mock('@node-rs/argon2');

describe('CustomerAuthService - Lockout & Brute Force Protection', () => {
  let service: CustomerAuthService;
  let prisma: {
    customer: {
      findUnique: jest.Mock;
      update: jest.Mock;
    };
  };
  let jwt: { signAsync: jest.Mock };
  let config: { get: jest.Mock };
  let mail: Partial<MailService>;

  beforeEach(() => {
    prisma = {
      customer: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    jwt = {
      signAsync: jest.fn().mockResolvedValue('mock-token'),
    };
    config = {
      get: jest.fn().mockReturnValue('mock-secret'),
    };
    mail = {};

    service = new CustomerAuthService(
      prisma as unknown as PrismaService,
      jwt as unknown as JwtService,
      config as unknown as ConfigService,
      mail as unknown as MailService,
    );
  });

  it('debe rechazar con error genérico si el cliente no existe', async () => {
    prisma.customer.findUnique.mockResolvedValue(null);

    await expect(
      service.login('tenant-1', {
        email: 'inexistente@cafe.co',
        password: 'Password123',
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('debe bloquear el acceso de inmediato si la cuenta está en período de bloqueo (lockedUntil futuro)', async () => {
    const futureDate = new Date(Date.now() + 10 * 60 * 1000); // 10 minutos en el futuro
    prisma.customer.findUnique.mockResolvedValue({
      id: 'cust-1',
      tenantId: 'tenant-1',
      email: 'test@cafe.co',
      passwordHash: '$argon2id$mock',
      emailVerified: true,
      failedAttempts: 5,
      lockedUntil: futureDate,
    });

    await expect(
      service.login('tenant-1', {
        email: 'test@cafe.co',
        password: 'Password123',
      }),
    ).rejects.toThrow(/bloqueada temporalmente/);
  });

  it('debe incrementar failedAttempts cuando la contraseña no coincide', async () => {
    prisma.customer.findUnique.mockResolvedValue({
      id: 'cust-1',
      tenantId: 'tenant-1',
      email: 'test@cafe.co',
      passwordHash: '$argon2id$mock',
      emailVerified: true,
      failedAttempts: 2,
      lockedUntil: null,
    });
    (argon2.verify as jest.Mock).mockResolvedValue(false);

    await expect(
      service.login('tenant-1', {
        email: 'test@cafe.co',
        password: 'ClaveIncorrecta',
      }),
    ).rejects.toThrow(UnauthorizedException);

    expect(prisma.customer.update).toHaveBeenCalledWith({
      where: { id: 'cust-1' },
      data: {
        failedAttempts: 3,
        lockedUntil: null,
      },
    });
  });

  it('debe activar lockedUntil al alcanzar el 5to intento fallido', async () => {
    prisma.customer.findUnique.mockResolvedValue({
      id: 'cust-1',
      tenantId: 'tenant-1',
      email: 'test@cafe.co',
      passwordHash: '$argon2id$mock',
      emailVerified: true,
      failedAttempts: 4,
      lockedUntil: null,
    });
    (argon2.verify as jest.Mock).mockResolvedValue(false);

    await expect(
      service.login('tenant-1', {
        email: 'test@cafe.co',
        password: 'ClaveIncorrecta',
      }),
    ).rejects.toThrow(/Demasiados intentos fallidos/);

    const lastCall = prisma.customer.update.mock.calls[0] as [
      {
        where: { id: string };
        data: { failedAttempts: number; lockedUntil: Date };
      },
    ];
    expect(lastCall[0].where.id).toBe('cust-1');
    expect(lastCall[0].data.failedAttempts).toBe(5);
    expect(lastCall[0].data.lockedUntil).toBeInstanceOf(Date);
  });

  it('debe resetear failedAttempts y lockedUntil tras un login exitoso', async () => {
    prisma.customer.findUnique.mockResolvedValue({
      id: 'cust-1',
      tenantId: 'tenant-1',
      name: 'Cliente Prueba',
      email: 'test@cafe.co',
      passwordHash: '$argon2id$mock',
      emailVerified: true,
      failedAttempts: 3,
      lockedUntil: null,
    });
    (argon2.verify as jest.Mock).mockResolvedValue(true);

    const result = await service.login('tenant-1', {
      email: 'test@cafe.co',
      password: 'ClaveCorrecta',
    });

    expect(result.customer.email).toBe('test@cafe.co');
    expect(prisma.customer.update).toHaveBeenCalledWith({
      where: { id: 'cust-1' },
      data: {
        failedAttempts: 0,
        lockedUntil: null,
      },
    });
  });
});
