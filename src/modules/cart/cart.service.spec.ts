import { BadRequestException } from '@nestjs/common';
import { GrindFormat } from '@prisma/client';
import { CartService } from './cart.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('CartService - Persistent Database Cart', () => {
  let service: CartService;
  let prisma: {
    cartItem: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      deleteMany: jest.Mock;
    };
    productVariant: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
    };
    discountCode: {
      findUnique: jest.Mock;
    };
    tenant: {
      findUnique: jest.Mock;
    };
  };

  const mockVariant = {
    id: 'var-1',
    sizeGrams: 250,
    grind: GrindFormat.WHOLE_BEAN,
    priceOneTime: 3500000, // $35.000 COP
    priceSubscription: null,
    stock: 10,
    product: {
      slug: 'geisha-huila',
      name: 'Geisha Huila',
      subscriptionAvailability: 'BOTH',
    },
  };

  beforeEach(() => {
    prisma = {
      cartItem: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        deleteMany: jest.fn(),
      },
      productVariant: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
      discountCode: {
        findUnique: jest.fn(),
      },
      tenant: {
        findUnique: jest.fn().mockResolvedValue({
          features: {
            freeShippingThresholdCents: 10000000, // $100.000
            shippingFlatCents: 1200000, // $12.000
          },
        }),
      },
    };

    service = new CartService(prisma as unknown as PrismaService);
  });

  describe('getCart', () => {
    it('debe devolver un carrito vacío con totales en 0 si no hay items en BD', async () => {
      prisma.cartItem.findMany.mockResolvedValue([]);

      const result = await service.getCart('tenant-1', 'cust-1');

      expect(result.rawItems).toEqual([]);
      expect(result.lines).toEqual([]);
      expect(result.totalCents).toBe(0);
      expect(result.subtotalCents).toBe(0);
    });

    it('debe devolver items con cálculo de precios cuando existen items en BD', async () => {
      prisma.cartItem.findMany.mockResolvedValue([
        {
          id: 'cart-item-1',
          variantId: 'var-1',
          quantity: 2,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
      prisma.productVariant.findMany.mockResolvedValue([mockVariant]);

      const result = await service.getCart('tenant-1', 'cust-1');

      expect(result.rawItems).toHaveLength(1);
      expect(result.lines).toHaveLength(1);
      expect(result.lines[0]?.productName).toBe('Geisha Huila');
      expect(result.subtotalCents).toBe(7000000); // 2 * $35.000
      expect(result.shippingCents).toBe(1200000); // Subtotal < 100.000
      expect(result.totalCents).toBe(8200000);
    });
  });

  describe('addItem', () => {
    it('debe lanzar BadRequestException si la variante no existe o está inactiva', async () => {
      prisma.productVariant.findFirst.mockResolvedValue(null);

      await expect(
        service.addItem('tenant-1', 'cust-1', {
          variantId: 'var-inexistente',
          quantity: 1,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('debe crear un nuevo CartItem si no existía previamente', async () => {
      prisma.productVariant.findFirst.mockResolvedValue({ id: 'var-1' });
      prisma.cartItem.findUnique.mockResolvedValue(null);
      prisma.cartItem.create.mockResolvedValue({});
      prisma.cartItem.findMany.mockResolvedValue([]);

      await service.addItem('tenant-1', 'cust-1', {
        variantId: 'var-1',
        quantity: 2,
      });

      expect(prisma.cartItem.create).toHaveBeenCalledWith({
        data: {
          tenantId: 'tenant-1',
          customerId: 'cust-1',
          variantId: 'var-1',
          quantity: 2,
        },
      });
    });

    it('debe incrementar la cantidad si el item ya existía en el carrito', async () => {
      prisma.productVariant.findFirst.mockResolvedValue({ id: 'var-1' });
      prisma.cartItem.findUnique.mockResolvedValue({
        id: 'cart-1',
        quantity: 2,
      });
      prisma.cartItem.update.mockResolvedValue({});
      prisma.cartItem.findMany.mockResolvedValue([]);

      await service.addItem('tenant-1', 'cust-1', {
        variantId: 'var-1',
        quantity: 3,
      });

      expect(prisma.cartItem.update).toHaveBeenCalledWith({
        where: { id: 'cart-1' },
        data: { quantity: 5 },
      });
    });
  });

  describe('updateItem', () => {
    it('debe eliminar el item si la cantidad es 0 o menor', async () => {
      prisma.cartItem.deleteMany.mockResolvedValue({ count: 1 });
      prisma.cartItem.findMany.mockResolvedValue([]);

      await service.updateItem('tenant-1', 'cust-1', 'var-1', { quantity: 0 });

      expect(prisma.cartItem.deleteMany).toHaveBeenCalledWith({
        where: {
          tenantId: 'tenant-1',
          customerId: 'cust-1',
          variantId: 'var-1',
        },
      });
    });

    it('debe actualizar la cantidad si es mayor a 0', async () => {
      prisma.cartItem.updateMany.mockResolvedValue({ count: 1 });
      prisma.cartItem.findMany.mockResolvedValue([]);

      await service.updateItem('tenant-1', 'cust-1', 'var-1', { quantity: 4 });

      expect(prisma.cartItem.updateMany).toHaveBeenCalledWith({
        where: {
          tenantId: 'tenant-1',
          customerId: 'cust-1',
          variantId: 'var-1',
        },
        data: { quantity: 4 },
      });
    });
  });

  describe('clearCart', () => {
    it('debe eliminar todos los items del carrito para ese cliente', async () => {
      prisma.cartItem.deleteMany.mockResolvedValue({ count: 3 });

      const response = await service.clearCart('tenant-1', 'cust-1');

      expect(prisma.cartItem.deleteMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1', customerId: 'cust-1' },
      });
      expect(response.message).toContain('vaciado');
    });
  });

  describe('mergeCart', () => {
    it('debe combinar items locales de localStorage con los de la base de datos', async () => {
      prisma.productVariant.findMany.mockResolvedValue([mockVariant]);
      // Simulamos que el item ya existía en BD con cantidad 1
      prisma.cartItem.findUnique.mockResolvedValue({
        id: 'cart-item-1',
        quantity: 1,
      });
      prisma.cartItem.update.mockResolvedValue({});
      prisma.cartItem.findMany.mockResolvedValue([]);

      await service.mergeCart('tenant-1', 'cust-1', {
        items: [{ variantId: 'var-1', quantity: 2 }],
      });

      expect(prisma.cartItem.update).toHaveBeenCalledWith({
        where: { id: 'cart-item-1' },
        data: { quantity: 3 }, // 1 previo + 2 de localStorage
      });
    });
  });
});
