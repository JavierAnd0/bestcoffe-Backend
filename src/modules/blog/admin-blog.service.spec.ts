import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AdminBlogService, blogPostStatus } from './admin-blog.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { RevalidationService } from '../revalidation/revalidation.service';

function makePrisma(
  opts: {
    existing?: { id: string; slug: string; publishedAt: Date | null } | null;
    taken?: string[];
  } = {},
) {
  const taken = new Set(opts.taken ?? []);
  const echo = (arg: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: 'p1', slug: 'x', publishedAt: null, ...arg.data });
  return {
    blogPost: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(opts.existing ?? null),
      findUnique: jest.fn(
        ({ where }: { where: { tenantId_slug: { slug: string } } }) =>
          Promise.resolve(
            taken.has(where.tenantId_slug.slug) ? { id: 'other' } : null,
          ),
      ),
      create: jest.fn(echo),
      update: jest.fn(echo),
      delete: jest.fn().mockResolvedValue({}),
    },
  };
}

function setup(opts: Parameters<typeof makePrisma>[0] = {}) {
  const prisma = makePrisma(opts);
  const revalidation = { dispatch: jest.fn() };
  const svc = new AdminBlogService(
    prisma as unknown as PrismaService,
    revalidation as unknown as RevalidationService,
  );
  return { prisma, revalidation, svc };
}

const createData = (p: ReturnType<typeof makePrisma>) =>
  (p.blogPost.create.mock.calls[0] as [{ data: Record<string, unknown> }])[0]
    .data;
const updateArg = (p: ReturnType<typeof makePrisma>) =>
  (
    p.blogPost.update.mock.calls[0] as [
      { where: unknown; data: Record<string, unknown> },
    ]
  )[0];

describe('AdminBlogService', () => {
  it('el listado filtra por la tienda e incluye borradores', async () => {
    const { prisma, svc } = setup();
    await svc.list('t1');
    expect(prisma.blogPost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 't1' } }),
    );
  });

  it('crea como borrador por defecto, con slug derivado del título', async () => {
    const { prisma, revalidation, svc } = setup();
    await svc.create('t1', 'demo', { title: 'Café de Huila', body: 'Hola' });
    const data = createData(prisma);
    expect(data).toMatchObject({
      tenantId: 't1',
      slug: 'cafe-de-huila',
      publishedAt: null,
    });
    expect(revalidation.dispatch).toHaveBeenCalledWith('demo', [
      'blog',
      'blog:cafe-de-huila',
    ]);
  });

  it('si el slug derivado está ocupado en la tienda, usa el siguiente libre', async () => {
    const { prisma, svc } = setup({ taken: ['cafe', 'cafe-2'] });
    await svc.create('t1', 'demo', { title: 'Café', body: 'x' });
    expect(createData(prisma).slug).toBe('cafe-3');
    // la comprobación de unicidad es por tienda
    expect(prisma.blogPost.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId_slug: { tenantId: 't1', slug: 'cafe' } },
      }),
    );
  });

  it('rechaza un slug explícito ya usado en la tienda', async () => {
    const { svc } = setup({ taken: ['usado'] });
    await expect(
      svc.create('t1', 'demo', { title: 'X', slug: 'usado', body: 'x' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('publicar al crear fija publishedAt', async () => {
    const { prisma, svc } = setup();
    await svc.create('t1', 'demo', { title: 'X', body: 'x', published: true });
    expect(createData(prisma).publishedAt).toBeInstanceOf(Date);
  });

  it('un id de otra tienda responde 404 y no escribe nada', async () => {
    const { prisma, svc } = setup({ existing: null });
    await expect(
      svc.update('t1', 'demo', 'ajeno', { title: 'intruso' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.remove('t1', 'demo', 'ajeno')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.blogPost.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'ajeno', tenantId: 't1' } }),
    );
    expect(prisma.blogPost.update).not.toHaveBeenCalled();
    expect(prisma.blogPost.delete).not.toHaveBeenCalled();
  });

  it('despublicar borra la fecha; publicar conserva la fecha original', async () => {
    const original = new Date('2026-01-01T00:00:00Z');
    const a = setup({
      existing: { id: 'p1', slug: 's', publishedAt: original },
    });
    await a.svc.unpublish('t1', 'demo', 'p1');
    expect(updateArg(a.prisma).data.publishedAt).toBeNull();

    const b = setup({
      existing: { id: 'p1', slug: 's', publishedAt: original },
    });
    await b.svc.publish('t1', 'demo', 'p1');
    expect(updateArg(b.prisma).data.publishedAt).toBe(original);
  });

  it('cambiar el slug revalida el viejo y el nuevo', async () => {
    const { revalidation, svc } = setup({
      existing: { id: 'p1', slug: 'viejo', publishedAt: null },
    });
    await svc.update('t1', 'demo', 'p1', { slug: 'nuevo' });
    expect(revalidation.dispatch).toHaveBeenCalledWith('demo', [
      'blog',
      'blog:viejo',
      'blog:nuevo',
    ]);
  });

  it('estado: borrador, programado o publicado', () => {
    const now = new Date('2026-06-01T00:00:00Z');
    expect(blogPostStatus(null, now)).toBe('DRAFT');
    expect(blogPostStatus(new Date('2026-07-01'), now)).toBe('SCHEDULED');
    expect(blogPostStatus(new Date('2026-05-01'), now)).toBe('PUBLISHED');
  });
});
