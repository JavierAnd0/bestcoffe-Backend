import { AdminDashboardService } from './admin-dashboard.service';

function build(branding: Record<string, unknown>) {
  const prisma = {
    productVariant: { findMany: jest.fn().mockResolvedValue([]) },
    review: { count: jest.fn().mockResolvedValue(0) },
    order: { count: jest.fn().mockResolvedValue(0) },
    tenant: { findUnique: jest.fn().mockResolvedValue({ branding }) },
  };
  return new AdminDashboardService(prisma as never);
}

describe('AdminDashboardService · alerta de correo de contacto', () => {
  it('avisa cuando la tienda no tiene correo de contacto', async () => {
    const alerts = await build({}).getAlerts('t1');
    expect(alerts.map((a) => a.id)).toContain('missing-contact-email');
    expect(alerts.map((a) => a.id)).not.toContain('all-ok');
  });

  it('no avisa si lo tiene', async () => {
    const alerts = await build({ contactEmail: 'hola@origen.co' }).getAlerts(
      't1',
    );
    expect(alerts.map((a) => a.id)).toEqual(['all-ok']);
  });
});
