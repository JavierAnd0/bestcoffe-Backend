import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { CustomerAuthService } from './customer-auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';

/**
 * Preapropiación de cuenta: alguien registra el correo de la víctima con su
 * propia contraseña (queda sin verificar). Cuando la víctima entra con Google,
 * neon-sync marca la cuenta verificada; esa contraseña ajena no puede seguir
 * sirviendo para entrar.
 */
describe('CustomerAuthService.syncNeonCustomer · credenciales de cuentas sin verificar', () => {
  const customerRow = {
    id: 'cus_1',
    email: 'victima@correo.test',
    tenantId: 'tenant-1',
    name: 'Víctima',
  };

  function build() {
    const tx = {
      customer: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        upsert: jest.fn().mockResolvedValue(customerRow),
      },
    };
    const prisma = {
      $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    const service = new CustomerAuthService(
      prisma as unknown as PrismaService,
      {
        signAsync: jest.fn().mockResolvedValue('token'),
      } as unknown as JwtService,
      { get: jest.fn().mockReturnValue('secret') } as unknown as ConfigService,
      {} as MailService,
    );
    return { service, tx, prisma };
  }

  it('borra contraseña y tokens solo de la cuenta del correo que nunca se verificó', async () => {
    const { service, tx } = build();

    await service.syncNeonCustomer('tenant-1', {
      email: 'victima@correo.test',
      name: 'Víctima',
    });

    expect(tx.customer.updateMany).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-1',
        email: 'victima@correo.test',
        emailVerified: false,
      },
      data: {
        passwordHash: null,
        emailVerifyToken: null,
        emailVerifyExpiresAt: null,
        passwordResetToken: null,
        passwordResetExpiresAt: null,
        failedAttempts: 0,
        lockedUntil: null,
      },
    });
  });

  it('limpia antes de marcar verificada, dentro de la misma transacción', async () => {
    const { service, tx, prisma } = build();
    const order: string[] = [];
    tx.customer.updateMany.mockImplementation(() => {
      order.push('limpiar');
      return Promise.resolve({ count: 1 });
    });
    tx.customer.upsert.mockImplementation(() => {
      order.push('verificar');
      return Promise.resolve(customerRow);
    });

    const out = await service.syncNeonCustomer('tenant-1', {
      email: 'victima@correo.test',
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['limpiar', 'verificar']);
    const [upsertArg] = tx.customer.upsert.mock.calls[0] as [
      { update: Record<string, unknown> },
    ];
    expect(upsertArg.update).toMatchObject({ emailVerified: true });
    expect(out.accessToken).toBe('token');
  });
});
