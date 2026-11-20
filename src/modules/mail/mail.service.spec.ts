import { ConfigService } from '@nestjs/config';
import { MailService, safeHref } from './mail.service';

/**
 * Inyección de HTML en correos (auditoría #8): todo lo variable se escapa y
 * los enlaces solo aceptan http(s).
 */
describe('MailService · contenido escapado', () => {
  const payload = '<a href="https://attacker.example/x">Verificar</a><!--';

  function build() {
    // Sin RESEND_API_KEY: send() no llama a la red; se espía para leer el HTML.
    // La tienda trae un nombre hostil: también debe salir escapado.
    const prisma = {
      tenant: {
        findUnique: jest.fn().mockResolvedValue({
          name: '<i>Tienda</i>',
          slug: 'tienda',
          branding: {},
        }),
      },
    };
    const svc = new MailService(
      { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService,
      prisma as never,
    );
    const send = jest
      .spyOn(
        svc as unknown as { send: (o: { html: string }) => Promise<void> },
        'send',
      )
      .mockResolvedValue(undefined);
    const html = () => send.mock.calls[0][0].html;
    return { svc, html };
  }

  it('verificación de cliente: el nombre del registro no inyecta HTML', async () => {
    const { svc, html } = build();
    await svc.sendCustomerVerification(
      'victima@correo.test',
      payload,
      'https://store.test/verify?t=1',
    );
    expect(html()).not.toContain('<a href="https://attacker.example');
    expect(html()).not.toContain('<!--');
    expect(html()).toContain('&lt;a href=&quot;https://attacker.example');
    expect(html()).toContain('href="https://store.test/verify?t=1"');
  });

  it('confirmación de pedido: nombre, tienda, producto y variante escapados', async () => {
    const { svc, html } = build();
    await svc.sendOrderConfirmation({
      to: 'c@correo.test',
      customerName: '<b>Ana</b>',
      orderId: 'ord_0000001',
      tenantId: 't1',
      totalCents: 100_00,
      items: [
        {
          productName: '<script>x</script>',
          variantName: '<u>340 g</u>',
          quantity: 1,
          lineCents: 100_00,
        },
      ],
    });
    const out = html();
    for (const raw of ['<b>Ana', '<i>Tienda', '<script>', '<u>340']) {
      expect(out).not.toContain(raw);
    }
    expect(out).toContain('&lt;b&gt;Ana&lt;/b&gt;');
  });

  it('envío despachado: una URL de rastreo que no es http(s) se omite', async () => {
    const { svc, html } = build();
    await svc.sendOrderShipped({
      to: 'c@correo.test',
      customerName: 'Ana',
      orderId: 'ord_0000001',
      tenantId: 't1',
      trackingUrl: 'javascript:alert(1)',
    });
    expect(html()).not.toContain('javascript:');
    expect(html()).not.toContain('Rastrear envío');
  });

  it('envío despachado: una URL de rastreo con comillas no rompe el atributo', async () => {
    const { svc, html } = build();
    await svc.sendOrderShipped({
      to: 'c@correo.test',
      customerName: 'Ana',
      orderId: 'ord_0000001',
      tenantId: 't1',
      trackingUrl: 'https://rastreo.test/x?a="><b>y</b>',
    });
    expect(html()).not.toContain('"><b>');
    expect(html()).toContain('Rastrear envío');
  });

  it('safeHref acepta http(s) y rechaza otros esquemas', () => {
    expect(safeHref('https://a.test/x')).toBe('https://a.test/x');
    expect(safeHref('http://a.test/')).toBe('http://a.test/');
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('data:text/html,hi')).toBeNull();
    expect(safeHref('no es url')).toBeNull();
    expect(safeHref(null)).toBeNull();
  });
  it('los correos de la tienda llevan su nombre y su enlace, y el texto escapado', async () => {
    const { svc, html } = build();
    await svc.sendOperatorMagicLink(
      'op@correo.test',
      'Ana',
      'https://tienda.test/acceso/verificar?token=1',
      't1',
    );
    const out = html();
    expect(out).toContain('&lt;i&gt;Tienda&lt;/i&gt;');
    expect(out).not.toContain('<i>Tienda');
    expect(out).toContain(
      'href="https://tienda.test/acceso/verificar?token=1"',
    );
    expect(out).toContain('Entrar al panel');
  });
  it('el pie lleva el contacto de la tienda y no el enlace en texto', async () => {
    const prisma = {
      tenant: {
        findUnique: jest.fn().mockResolvedValue({
          name: 'ORÍGEN',
          slug: 'origen',
          branding: { contactEmail: 'hola@origen.co' },
        }),
      },
    };
    const svc = new MailService(
      { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService,
      prisma as never,
    );
    const send = jest
      .spyOn(
        svc as unknown as { send: (o: { html: string }) => Promise<void> },
        'send',
      )
      .mockResolvedValue(undefined);
    await svc.sendOperatorMagicLink(
      'op@correo.test',
      null,
      'https://x.test/a',
      't1',
    );
    const out = send.mock.calls[0][0].html;
    expect(out).toContain('mailto:hola@origen.co');
    expect(out).not.toContain('copia este enlace');
  });
});
