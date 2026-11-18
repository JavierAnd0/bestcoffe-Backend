import { BadRequestException } from '@nestjs/common';
import { assertOwnBlobImage } from './admin-products.service';

/**
 * Una tienda no puede adjuntar a sus productos una imagen del Blob de otra
 * tienda: al quitarla, el panel borraría el archivo ajeno.
 */
describe('assertOwnBlobImage', () => {
  const blob = 'https://abc.public.blob.vercel-storage.com';

  it('acepta imágenes de Blob en la carpeta de la propia tienda', () => {
    expect(() =>
      assertOwnBlobImage(`${blob}/products/origen/p1/foto-x1.jpg`, 'origen'),
    ).not.toThrow();
  });

  it('rechaza imágenes de Blob de otra tienda', () => {
    expect(() =>
      assertOwnBlobImage(`${blob}/products/otra/p1/foto.jpg`, 'origen'),
    ).toThrow(BadRequestException);
  });

  it('rechaza un slug que solo empieza igual (origen vs origen-falso)', () => {
    expect(() =>
      assertOwnBlobImage(`${blob}/products/origen-falso/f.jpg`, 'origen'),
    ).toThrow(BadRequestException);
  });

  it('rechaza salir de la carpeta con .. (también codificado)', () => {
    expect(() =>
      assertOwnBlobImage(`${blob}/products/origen/%2E%2E/otra/f.jpg`, 'origen'),
    ).toThrow(BadRequestException);
  });

  it('rechaza otras carpetas del Blob (contenido)', () => {
    expect(() =>
      assertOwnBlobImage(`${blob}/content/origen/blog/f.jpg`, 'origen'),
    ).toThrow(BadRequestException);
  });

  it('sigue aceptando URLs externas', () => {
    expect(() =>
      assertOwnBlobImage('https://images.example.com/cafe.jpg', 'origen'),
    ).not.toThrow();
  });
});
