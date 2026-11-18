import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AdminBrewGuidesService } from './admin-brew-guides.service';
import { AdminLocationsService } from './admin-locations.service';
import { parseBrewGuideBody } from './brew-guide-body';
import type { PrismaService } from '../../prisma/prisma.service';
import type { RevalidationService } from '../revalidation/revalidation.service';

const echo = (arg: { data: Record<string, unknown> }) =>
  Promise.resolve({
    id: 'g1',
    tenantId: 't1',
    slug: 'x',
    title: 't',
    method: null,
    coverUrl: null,
    body: '',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...arg.data,
  });

function model(existing: unknown = null) {
  return {
    findMany: jest.fn().mockResolvedValue([]),
    findFirst: jest.fn().mockResolvedValue(existing),
    findUnique: jest.fn().mockResolvedValue(null),
    create: jest.fn(echo),
    update: jest.fn(echo),
    delete: jest.fn().mockResolvedValue({}),
  };
}

const firstData = (m: jest.Mock) =>
  (m.mock.calls[0] as [{ data: Record<string, unknown> }])[0].data;

describe('parseBrewGuideBody', () => {
  it('un body en texto (guías antiguas) se muestra como resumen sin pasos', () => {
    expect(parseBrewGuideBody('Texto libre')).toMatchObject({
      summary: 'Texto libre',
      steps: [],
      difficulty: 'Media',
    });
  });

  it('descarta valores de tipo incorrecto', () => {
    const parsed = parseBrewGuideBody(
      JSON.stringify({ difficulty: 'Extrema', steps: [{ title: 1 }, null] }),
    );
    expect(parsed.difficulty).toBe('Media');
    expect(parsed.steps).toEqual([
      { title: '', body: '', durationSec: 0, waterG: null },
    ]);
  });

  it('lee la receta y el agua de cada paso; las guías sin receta quedan vacías', () => {
    const parsed = parseBrewGuideBody(
      JSON.stringify({
        recipe: { coffeeG: 15, waterMl: 250, tempC: 93, grind: 'Media-fina' },
        steps: [{ title: 'Bloom', durationSec: 40, waterG: 45 }],
      }),
    );
    expect(parsed.recipe).toEqual({
      coffeeG: 15,
      waterMl: 250,
      tempC: 93,
      grind: 'Media-fina',
    });
    expect(parsed.steps[0].waterG).toBe(45);

    expect(parseBrewGuideBody(JSON.stringify({ steps: [] })).recipe).toEqual({
      coffeeG: null,
      waterMl: null,
      tempC: null,
      grind: '',
    });
    expect(
      parseBrewGuideBody(
        JSON.stringify({ recipe: { coffeeG: -3, tempC: 'x' } }),
      ).recipe,
    ).toMatchObject({ coffeeG: null, tempC: null });
  });
});

describe('AdminBrewGuidesService', () => {
  const setup = (existing: unknown = null) => {
    const brewGuide = model(existing);
    const revalidation = { dispatch: jest.fn() };
    const svc = new AdminBrewGuidesService(
      { brewGuide } as unknown as PrismaService,
      revalidation as unknown as RevalidationService,
    );
    return { brewGuide, revalidation, svc };
  };

  it('crea con los pasos serializados en body y slug del método', async () => {
    const { brewGuide, revalidation, svc } = setup();
    const view = await svc.create('t1', 'demo', {
      title: 'Guía de prensa',
      method: 'Prensa francesa',
      difficulty: 'Fácil',
      steps: [{ title: 'Moler', durationSec: 30 }],
    });
    const data = firstData(brewGuide.create);
    expect(data).toMatchObject({ tenantId: 't1', slug: 'prensa-francesa' });
    expect(parseBrewGuideBody(data.body as string).steps).toEqual([
      { title: 'Moler', body: '', durationSec: 30, waterG: null },
    ]);
    expect(view).toMatchObject({ difficulty: 'Fácil' });
    expect(view).not.toHaveProperty('tenantId');
    expect(view).not.toHaveProperty('body');
    expect(revalidation.dispatch).toHaveBeenCalledWith('demo', [
      'brew-guides',
      'brew-guide:prensa-francesa',
    ]);
  });

  it('editar solo el resumen conserva los pasos existentes', async () => {
    const body = JSON.stringify({
      summary: 'viejo',
      steps: [{ title: 'Paso', body: '', durationSec: 10 }],
    });
    const { brewGuide, svc } = setup({ id: 'g1', slug: 'v60', body });
    await svc.update('t1', 'demo', 'g1', { summary: 'nuevo' });
    const parsed = parseBrewGuideBody(
      firstData(brewGuide.update).body as string,
    );
    expect(parsed.summary).toBe('nuevo');
    expect(parsed.steps).toHaveLength(1);
  });

  it('un id de otra tienda responde 404', async () => {
    const { brewGuide, svc } = setup(null);
    await expect(svc.remove('t1', 'demo', 'ajeno')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(brewGuide.findFirst).toHaveBeenCalledWith({
      where: { id: 'ajeno', tenantId: 't1' },
    });
    expect(brewGuide.delete).not.toHaveBeenCalled();
  });
});

describe('AdminLocationsService', () => {
  const setup = (existing: unknown = null) => {
    const storeLocation = model(existing);
    const revalidation = { dispatch: jest.fn() };
    const svc = new AdminLocationsService(
      { storeLocation } as unknown as PrismaService,
      revalidation as unknown as RevalidationService,
    );
    return { storeLocation, revalidation, svc };
  };

  it('crea la sede en la tienda y revalida /tiendas', async () => {
    const { storeLocation, revalidation, svc } = setup();
    await svc.create('t1', 'demo', {
      name: ' Sede Norte ',
      address: 'Cl 1',
      city: 'Cali',
      hours: 'Lun–Vie',
      phone: '',
    });
    expect(firstData(storeLocation.create)).toMatchObject({
      tenantId: 't1',
      name: 'Sede Norte',
      hours: 'Lun–Vie',
      phone: null,
      lat: null,
    });
    expect(revalidation.dispatch).toHaveBeenCalledWith('demo', ['locations']);
  });

  it('vaciar el horario lo borra (DbNull)', async () => {
    const { storeLocation, svc } = setup({ id: 'l1' });
    await svc.update('t1', 'demo', 'l1', { hours: '' });
    expect(firstData(storeLocation.update).hours).toBe(Prisma.DbNull);
  });

  it('un id de otra tienda responde 404 y no modifica nada', async () => {
    const { storeLocation, svc } = setup(null);
    await expect(
      svc.update('t1', 'demo', 'ajeno', { name: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(storeLocation.update).not.toHaveBeenCalled();
  });
});
