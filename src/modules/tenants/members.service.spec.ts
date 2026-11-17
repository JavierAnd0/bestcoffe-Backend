import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PrismaService } from '../../prisma/prisma.service';
import { MembersService } from './members.service';
import { AddMemberDto, UpdateMemberRoleDto } from './dto/member.dto';

const TENANT = 'tenant_a';

function makePrisma() {
  return {
    user: { upsert: jest.fn() },
    tenantMembership: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
  };
}

function setup() {
  const prisma = makePrisma();
  const service = new MembersService(prisma as unknown as PrismaService);
  return { prisma, service };
}

describe('MembersService', () => {
  describe('list', () => {
    it('filtra por la tienda y aplana los datos del usuario', async () => {
      const { prisma, service } = setup();
      const createdAt = new Date('2026-01-01T00:00:00Z');
      prisma.tenantMembership.findMany.mockResolvedValue([
        {
          role: 'TENANT_OWNER',
          createdAt,
          user: { id: 'u1', email: 'a@x.co', name: 'Ana' },
        },
      ]);

      const res = await service.list(TENANT);

      expect(prisma.tenantMembership.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: TENANT } }),
      );
      expect(res).toEqual([
        {
          userId: 'u1',
          email: 'a@x.co',
          name: 'Ana',
          role: 'TENANT_OWNER',
          createdAt,
        },
      ]);
    });
  });

  describe('add', () => {
    it('crea el usuario si no existe y lo agrega a ESTA tienda con el rol pedido', async () => {
      const { prisma, service } = setup();
      prisma.user.upsert.mockResolvedValue({
        id: 'u2',
        email: 'editor@x.co',
        name: null,
      });
      prisma.tenantMembership.findUnique.mockResolvedValue(null);

      const res = await service.add(TENANT, {
        email: 'editor@x.co',
        role: 'TENANT_EDITOR',
      });

      expect(prisma.user.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { email: 'editor@x.co' } }),
      );
      expect(prisma.tenantMembership.create).toHaveBeenCalledWith({
        data: { userId: 'u2', tenantId: TENANT, role: 'TENANT_EDITOR' },
      });
      expect(res).toMatchObject({ userId: 'u2', role: 'TENANT_EDITOR' });
    });

    it('rechaza a quien ya es miembro de la tienda', async () => {
      const { prisma, service } = setup();
      prisma.user.upsert.mockResolvedValue({ id: 'u2', email: 'e@x.co' });
      prisma.tenantMembership.findUnique.mockResolvedValue({ userId: 'u2' });

      await expect(
        service.add(TENANT, { email: 'e@x.co', role: 'TENANT_EDITOR' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.tenantMembership.create).not.toHaveBeenCalled();
    });
  });

  describe('updateRole', () => {
    it('no deja degradar al último dueño (tampoco a uno mismo)', async () => {
      const { prisma, service } = setup();
      prisma.tenantMembership.findUnique.mockResolvedValue({
        role: 'TENANT_OWNER',
      });
      prisma.tenantMembership.count.mockResolvedValue(0);

      await expect(
        service.updateRole(TENANT, 'owner', { role: 'TENANT_EDITOR' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.tenantMembership.count).toHaveBeenCalledWith({
        where: {
          tenantId: TENANT,
          role: 'TENANT_OWNER',
          NOT: { userId: 'owner' },
        },
      });
      expect(prisma.tenantMembership.update).not.toHaveBeenCalled();
    });

    it('permite degradar a un dueño si queda otro', async () => {
      const { prisma, service } = setup();
      prisma.tenantMembership.findUnique.mockResolvedValue({
        role: 'TENANT_OWNER',
      });
      prisma.tenantMembership.count.mockResolvedValue(1);
      prisma.tenantMembership.update.mockResolvedValue({
        role: 'TENANT_ORDERS',
        user: { id: 'owner2', email: 'o2@x.co', name: null },
      });

      const res = await service.updateRole(TENANT, 'owner2', {
        role: 'TENANT_ORDERS',
      });

      expect(prisma.tenantMembership.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId_tenantId: { userId: 'owner2', tenantId: TENANT } },
          data: { role: 'TENANT_ORDERS' },
        }),
      );
      expect(res.role).toBe('TENANT_ORDERS');
    });

    it('cambiar el rol de un no-dueño no consulta los dueños', async () => {
      const { prisma, service } = setup();
      prisma.tenantMembership.findUnique.mockResolvedValue({
        role: 'TENANT_EDITOR',
      });
      prisma.tenantMembership.update.mockResolvedValue({
        role: 'TENANT_ORDERS',
        user: { id: 'u3', email: 'u3@x.co', name: null },
      });

      await service.updateRole(TENANT, 'u3', { role: 'TENANT_ORDERS' });
      expect(prisma.tenantMembership.count).not.toHaveBeenCalled();
    });

    it('404 si la persona no es miembro de ESTA tienda (aislamiento)', async () => {
      const { prisma, service } = setup();
      prisma.tenantMembership.findUnique.mockResolvedValue(null);

      await expect(
        service.updateRole(TENANT, 'de-otra-tienda', { role: 'TENANT_OWNER' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.tenantMembership.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId_tenantId: { userId: 'de-otra-tienda', tenantId: TENANT },
          },
        }),
      );
      expect(prisma.tenantMembership.update).not.toHaveBeenCalled();
    });

    it('no toca una membresía de plataforma', async () => {
      const { prisma, service } = setup();
      prisma.tenantMembership.findUnique.mockResolvedValue({
        role: 'PLATFORM_OWNER',
      });

      await expect(
        service.updateRole(TENANT, 'plat', { role: 'TENANT_EDITOR' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.tenantMembership.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('no deja quitar al último dueño (tampoco a uno mismo)', async () => {
      const { prisma, service } = setup();
      prisma.tenantMembership.findUnique.mockResolvedValue({
        role: 'TENANT_OWNER',
      });
      prisma.tenantMembership.count.mockResolvedValue(0);

      await expect(service.remove(TENANT, 'owner')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.tenantMembership.delete).not.toHaveBeenCalled();
    });

    it('quita a un miembro solo de esta tienda', async () => {
      const { prisma, service } = setup();
      prisma.tenantMembership.findUnique.mockResolvedValue({
        role: 'TENANT_EDITOR',
      });

      const res = await service.remove(TENANT, 'u3');

      expect(prisma.tenantMembership.delete).toHaveBeenCalledWith({
        where: { userId_tenantId: { userId: 'u3', tenantId: TENANT } },
      });
      expect(res).toEqual({ userId: 'u3', removed: true });
    });

    it('404 si no es miembro de esta tienda', async () => {
      const { prisma, service } = setup();
      prisma.tenantMembership.findUnique.mockResolvedValue(null);
      await expect(service.remove(TENANT, 'x')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('no quita una membresía de plataforma', async () => {
      const { prisma, service } = setup();
      prisma.tenantMembership.findUnique.mockResolvedValue({
        role: 'PLATFORM_OWNER',
      });
      await expect(service.remove(TENANT, 'plat')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.tenantMembership.delete).not.toHaveBeenCalled();
    });
  });
});

describe('DTOs de miembros', () => {
  async function errors<T extends object>(cls: new () => T, body: object) {
    return validate(plainToInstance(cls, body), {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
  }

  it('normaliza el correo y acepta los roles de tienda', async () => {
    const dto = plainToInstance(AddMemberDto, {
      email: '  Editor@X.co ',
      role: 'TENANT_ORDERS',
    });
    expect(dto.email).toBe('editor@x.co');
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rechaza asignar PLATFORM_OWNER desde la tienda', async () => {
    expect(
      await errors(AddMemberDto, { email: 'a@x.co', role: 'PLATFORM_OWNER' }),
    ).toHaveLength(1);
    expect(
      await errors(UpdateMemberRoleDto, { role: 'PLATFORM_OWNER' }),
    ).toHaveLength(1);
  });

  describe('invitación por correo', () => {
    it('al agregar un miembro le envía la invitación con el enlace de su tienda', async () => {
      const prisma = {
        user: {
          upsert: jest.fn().mockResolvedValue({
            id: 'u9',
            email: 'nuevo@demo.test',
            name: 'Nuevo',
          }),
        },
        tenantMembership: {
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({}),
        },
        tenant: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ name: 'Cafetería Demo', slug: 'demo' }),
        },
      };
      const mail = {
        sendMemberInvitation: jest.fn().mockResolvedValue(undefined),
      };
      const prev = process.env.PLATFORM_DOMAIN;
      process.env.PLATFORM_DOMAIN = 'bestcoffee.io';
      const svc = new MembersService(
        prisma as unknown as PrismaService,
        mail as never,
      );

      await svc.add('t1', {
        email: 'nuevo@demo.test',
        name: 'Nuevo',
        role: 'TENANT_EDITOR',
      } as never);
      await new Promise((r) => setImmediate(r));
      process.env.PLATFORM_DOMAIN = prev;

      expect(mail.sendMemberInvitation).toHaveBeenCalledWith({
        to: 'nuevo@demo.test',
        name: 'Nuevo',
        storeName: 'Cafetería Demo',
        roleLabel: 'Editor (catálogo y contenido)',
        accessUrl: 'https://demo.bestcoffee.io/acceso?email=nuevo%40demo.test',
      });
    });
  });
});
