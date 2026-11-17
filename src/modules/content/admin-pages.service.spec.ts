import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AdminPagesService } from './admin-pages.service';
import { ContentService } from './content.service';
import { publicBranding } from './editorial-pages';
import type { PrismaService } from '../../prisma/prisma.service';
import type { RevalidationService } from '../revalidation/revalidation.service';

type SavedBranding = {
  accent?: string;
  pages: Record<string, boolean>;
  editorialPages: Record<string, Record<string, unknown>>;
};

const PAGE = {
  title: 'Nuestra historia',
  sections: [{ title: 'Inicio', body: 'Texto' }],
};

function setup(branding: Record<string, unknown> = {}) {
  const tenant = {
    findUnique: jest.fn().mockResolvedValue({ branding }),
    update: jest.fn().mockResolvedValue({}),
  };
  const revalidation = { dispatch: jest.fn() };
  const prisma = { tenant } as unknown as PrismaService;
  const svc = new AdminPagesService(
    prisma,
    revalidation as unknown as RevalidationService,
  );
  const saved = () =>
    (tenant.update.mock.calls[0] as [{ data: { branding: SavedBranding } }])[0]
      .data.branding;
  return { tenant, revalidation, svc, saved, prisma };
}

describe('AdminPagesService', () => {
  it('lista las cuatro páginas de contenido y el interruptor de sedes', async () => {
    const { svc } = setup({ pages: { tiendas: true } });
    const list = await svc.list('t1');
    expect(list.map((p) => p.slug)).toEqual([
      'historia',
      'impacto',
      'sostenibilidad',
      'mayoristas',
      'tiendas',
    ]);
    expect(list.find((p) => p.slug === 'tiendas')).toMatchObject({
      kind: 'toggle',
      active: true,
      live: true,
    });
    expect(list[0]).toMatchObject({ active: false, content: null });
  });

  it('guarda el contenido saneado sin tocar el resto del branding', async () => {
    const { svc, saved, revalidation } = setup({
      accent: '#123456',
      pages: { tiendas: true },
    });
    await svc.save('t1', 'demo', 'historia', {
      content: {
        title: '  Nuestra historia ',
        eyebrow: '',
        sections: [
          { title: 'A', body: 'uno\r\n\r\ndos' },
          { title: '', body: '  ' },
        ],
      },
    });
    const b = saved();
    expect(b.accent).toBe('#123456');
    expect(b.pages).toEqual({ tiendas: true });
    expect(b.editorialPages.historia).toMatchObject({
      title: 'Nuestra historia',
      sections: [{ title: 'A', body: 'uno\n\ndos' }],
    });
    expect(b.editorialPages.historia).not.toHaveProperty('eyebrow');
    expect(revalidation.dispatch).toHaveBeenCalledWith('demo', [
      'settings',
      'pages',
      'page:historia',
    ]);
  });

  it('activar escribe branding.pages (la misma clave del superadmin)', async () => {
    const { svc, saved } = setup({
      pages: { impacto: false },
      editorialPages: { historia: PAGE },
    });
    const view = await svc.save('t1', 'demo', 'historia', { active: true });
    expect(saved().pages).toEqual({ impacto: false, historia: true });
    expect(view).toMatchObject({ active: true, live: true });
  });

  it('no deja activar una página sin contenido', async () => {
    const { svc, tenant } = setup({});
    await expect(
      svc.save('t1', 'demo', 'mayoristas', { active: true }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tenant.update).not.toHaveBeenCalled();
  });

  it('contenido y activación en la misma petición', async () => {
    const { svc, saved } = setup({});
    await svc.save('t1', 'demo', 'impacto', { active: true, content: PAGE });
    expect(saved().pages).toEqual({ impacto: true });
  });

  it('sedes solo se activa: no admite texto', async () => {
    const { svc } = setup({});
    await expect(
      svc.save('t1', 'demo', 'tiendas', { content: PAGE }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await svc.save('t1', 'demo', 'tiendas', { active: false });
  });

  it('un botón sin enlace se rechaza', async () => {
    const { svc } = setup({});
    await expect(
      svc.save('t1', 'demo', 'mayoristas', {
        content: { ...PAGE, cta: { label: 'Escríbenos' } },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('una página desconocida es 404', async () => {
    const { svc } = setup({});
    await expect(svc.findOne('t1', 'contacto')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      svc.save('t1', 'demo', '../x', { active: true }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lee y escribe siempre la tienda de la petición', async () => {
    const { svc, tenant } = setup({});
    await svc.save('t-propia', 'demo', 'impacto', { content: PAGE });
    expect(tenant.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 't-propia' } }),
    );
    expect(tenant.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 't-propia' } }),
    );
  });
});

describe('ContentService.getPage', () => {
  const svc = (branding: unknown) =>
    new ContentService({
      tenant: { findUnique: jest.fn().mockResolvedValue({ branding }) },
    } as unknown as PrismaService);

  it('devuelve la página activa con contenido', async () => {
    const page = await svc({
      pages: { historia: true },
      editorialPages: { historia: PAGE },
    }).getPage('t1', 'historia');
    expect(page).toMatchObject({ slug: 'historia', title: 'Nuestra historia' });
  });

  it.each([
    [
      'apagada',
      { pages: { historia: false }, editorialPages: { historia: PAGE } },
    ],
    ['sin contenido', { pages: { historia: true } }],
    ['sin bandera', { editorialPages: { historia: PAGE } }],
  ])('404 si está %s', async (_n, branding) => {
    await expect(
      svc(branding).getPage('t1', 'historia'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('sedes no es una página de contenido', async () => {
    await expect(
      svc({ pages: { tiendas: true } }).getPage('t1', 'tiendas'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('publicBranding', () => {
  it('quita el texto de las páginas y publica las banderas efectivas', () => {
    const out = publicBranding({
      accent: '#fff',
      pages: { historia: true, impacto: true, tiendas: true },
      editorialPages: { historia: PAGE },
    });
    expect(out).not.toHaveProperty('editorialPages');
    expect(out.accent).toBe('#fff');
    expect(out.pages).toEqual({
      historia: true,
      impacto: false,
      sostenibilidad: false,
      mayoristas: false,
      tiendas: true,
    });
  });
});
