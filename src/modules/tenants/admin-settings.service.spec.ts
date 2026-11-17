import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PrismaService } from '../../prisma/prisma.service';
import { RevalidationService } from '../revalidation/revalidation.service';
import { AdminSettingsService } from './admin-settings.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';

/** Valida como el ValidationPipe global (whitelist + forbidNonWhitelisted). */
async function errorsFor(body: object) {
  const dto = plainToInstance(UpdateSettingsDto, body);
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors;
}

describe('UpdateSettingsDto — datos de la empresa en branding', () => {
  it('acepta razón social, NIT, contacto y ciudad', async () => {
    const errors = await errorsFor({
      branding: {
        legalName: 'Mi Café S.A.S.',
        legalId: '900.000.000-0',
        contactEmail: 'hola@micafe.co',
        contactPhone: '+57 300 123 4567',
        city: 'Medellín',
      },
    });
    expect(errors).toHaveLength(0);
  });

  it('acepta el cuerpo completo que envía el panel (saveAdminSettingsAction)', async () => {
    const errors = await errorsFor({
      name: 'Demo',
      shipping: {
        freeShippingThresholdCents: 12_000_000,
        shippingFlatCents: 900_000,
      },
      branding: {
        legalName: '',
        legalId: '',
        contactEmail: 'demo@example.com',
        contactPhone: '',
        city: 'Bogotá',
      },
    });
    expect(errors).toHaveLength(0);
  });

  it('acepta cadena vacía para borrar el correo de contacto', async () => {
    expect(await errorsFor({ branding: { contactEmail: '' } })).toHaveLength(0);
  });

  it('rechaza un correo de contacto inválido', async () => {
    const errors = await errorsFor({ branding: { contactEmail: 'no-correo' } });
    expect(errors).toHaveLength(1);
  });

  it('sigue rechazando claves de branding que el dueño no controla', async () => {
    const errors = await errorsFor({ branding: { hero: 'scene3d' } });
    expect(errors).toHaveLength(1);
  });
});

describe('AdminSettingsService.update — fusión de branding', () => {
  it('fusiona los datos de la empresa sin perder el resto del branding', async () => {
    const current = {
      id: 't1',
      slug: 'demo',
      name: 'Demo',
      tier: 'BUSINESS',
      features: { maxProducts: -1 },
      branding: { accent: '#2f6f5e', hero: 'classic', legalName: 'Viejo' },
      updatedAt: new Date(),
    };
    const update = jest.fn((args: { data: object }) =>
      Promise.resolve({ ...current, ...args.data }),
    );
    const prisma = {
      tenant: {
        findUnique: jest.fn().mockResolvedValue(current),
        update,
      },
    } as unknown as PrismaService;
    const dispatch = jest.fn();
    const service = new AdminSettingsService(prisma, {
      dispatch,
    } as unknown as RevalidationService);

    await service.update('t1', 'demo', {
      branding: { legalName: 'Mi Café S.A.S.', legalId: '900.1', city: '' },
    });

    const data = (update.mock.calls[0][0] as { data: { branding: object } })
      .data;
    expect(data.branding).toEqual({
      accent: '#2f6f5e',
      hero: 'classic',
      legalName: 'Mi Café S.A.S.',
      legalId: '900.1',
      city: '',
    });
    expect(dispatch).toHaveBeenCalledWith('demo', ['settings']);
  });
});
