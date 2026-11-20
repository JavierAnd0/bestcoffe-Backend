import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { deriveSecretBoxKey, open, seal } from '../../common/crypto/secret-box';
import { EnviaApiError, EnviaClient, type EnviaState } from './envia.client';
import { normalizePlaceName } from './envia-status';
import type {
  SaveEnviaConnectionDto,
  ShippingPackageDefaultsDto,
} from './dto/shipping.dto';

export const ENVIA_CLIENT_FACTORY = Symbol('ENVIA_CLIENT_FACTORY');
export type EnviaClientFactory = (token: string, test: boolean) => EnviaClient;

/** Dirección de despacho guardada, ya validada contra Envia. */
export type StoredOrigin = {
  name: string;
  company?: string;
  phone: string;
  email?: string;
  street: string;
  reference?: string;
  city: string; // nombre tal cual lo escribió la tienda
  state: string;
  cityCode: string; // DANE
  stateCode: string; // código de Envia
  identificationNumber?: string;
};

export type StoredPackage = ShippingPackageDefaultsDto;

export const DEFAULT_PACKAGE: StoredPackage = {
  lengthCm: 20,
  widthCm: 15,
  heightCm: 10,
  packagingGrams: 150,
};

/** Cuenta de Envia lista para usar (token ya descifrado). */
export type EnviaAccount = {
  tenantId: string;
  client: EnviaClient;
  test: boolean;
  origin: StoredOrigin;
  package: StoredPackage;
};

const STATES_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Cuenta de Envia de cada tienda: guardar el token (cifrado), validar la
 * dirección de despacho, registrar el webhook y entregar un cliente listo
 * para los demás servicios.
 */
@Injectable()
export class EnviaAccountService {
  private readonly logger = new Logger(EnviaAccountService.name);
  private readonly boxKey = deriveSecretBoxKey();
  /** Departamentos de Envia por entorno; cambian casi nunca. */
  private readonly statesCache = new Map<
    string,
    { at: number; states: EnviaState[] }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(ENVIA_CLIENT_FACTORY)
    private readonly clientFactory: EnviaClientFactory,
  ) {}

  async getStatus(tenantId: string) {
    const t = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: {
        enviaConnected: true,
        enviaTest: true,
        enviaOrigin: true,
        enviaPackage: true,
        enviaWebhookId: true,
        enviaWebhookSecret: true,
      },
    });
    return {
      connected: t.enviaConnected,
      test: t.enviaTest,
      origin: (t.enviaOrigin as StoredOrigin | null) ?? null,
      package: (t.enviaPackage as StoredPackage | null) ?? DEFAULT_PACKAGE,
      webhookRegistered: t.enviaWebhookId != null,
      hasWebhookSecret: !!t.enviaWebhookSecret,
    };
  }

  /**
   * Conecta (o actualiza) la cuenta de Envia de la tienda. Antes de guardar
   * prueba el token y valida la dirección de despacho, para que un error de
   * copiado salga aquí y no al generar la primera guía.
   */
  async save(tenantId: string, dto: SaveEnviaConnectionDto) {
    const current = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: {
        enviaToken: true,
        enviaTest: true,
        enviaWebhookId: true,
      },
    });

    const newToken = dto.token?.trim();
    const token =
      newToken ||
      (current.enviaToken ? open(current.enviaToken, this.boxKey) : '');
    if (!token) {
      throw new BadRequestException(
        'Pega el token de API de tu cuenta de Envia',
      );
    }
    const client = this.clientFactory(token, dto.test);

    try {
      await client.carriers();
    } catch (err) {
      const env = dto.test ? 'pruebas (sandbox)' : 'producción';
      throw new BadRequestException(
        err instanceof EnviaApiError && err.status === 401
          ? `Envia rechazó el token en ${env}. Revisa que sea del mismo entorno (Desarrolladores → API Keys).`
          : `No se pudo validar el token con Envia: ${(err as Error).message}`,
      );
    }

    const place = await this.resolvePlace(
      client,
      dto.test,
      dto.origin.city,
      dto.origin.state,
    );
    if (!place) {
      throw new BadRequestException(
        `Envia no reconoce "${dto.origin.city}, ${dto.origin.state}". Revisa la ciudad y el departamento de despacho.`,
      );
    }

    const origin: StoredOrigin = {
      ...dto.origin,
      cityCode: place.cityCode,
      stateCode: place.stateCode,
    };

    // El webhook es de la cuenta de Envia: si cambia el token o el entorno,
    // hay que registrarlo de nuevo en la cuenta nueva.
    const accountChanged = !!newToken || current.enviaTest !== dto.test;
    let webhookId = accountChanged ? null : current.enviaWebhookId;
    if (webhookId == null)
      webhookId = await this.registerWebhook(tenantId, client);

    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        enviaToken: seal(token, this.boxKey),
        ...(dto.webhookSecret !== undefined && {
          enviaWebhookSecret: dto.webhookSecret.trim()
            ? seal(dto.webhookSecret.trim(), this.boxKey)
            : null,
        }),
        enviaTest: dto.test,
        enviaConnected: true,
        enviaWebhookId: webhookId,
        enviaOrigin: origin,
        enviaPackage: { ...dto.package },
      },
    });
    return this.getStatus(tenantId);
  }

  async disconnect(tenantId: string) {
    const t = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { enviaToken: true, enviaTest: true, enviaWebhookId: true },
    });
    if (t.enviaToken && t.enviaWebhookId != null) {
      try {
        await this.clientFactory(
          open(t.enviaToken, this.boxKey),
          t.enviaTest,
        ).deactivateWebhook(t.enviaWebhookId);
      } catch (err) {
        this.logger.warn(
          `No se pudo desactivar el webhook de Envia de ${tenantId}: ${String(err)}`,
        );
      }
    }
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        enviaConnected: false,
        enviaToken: null,
        enviaWebhookSecret: null,
        enviaWebhookId: null,
      },
    });
    return { disconnected: true as const };
  }

  /** Cuenta conectada de la tienda, o error claro para el panel. */
  async requireAccount(tenantId: string): Promise<EnviaAccount> {
    const account = await this.findAccount(tenantId);
    if (!account) {
      throw new BadRequestException(
        'Conecta tu cuenta de Envia en Configuración → Envíos para generar guías',
      );
    }
    return account;
  }

  async findAccount(tenantId: string): Promise<EnviaAccount | null> {
    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        enviaConnected: true,
        enviaToken: true,
        enviaTest: true,
        enviaOrigin: true,
        enviaPackage: true,
      },
    });
    if (!t?.enviaConnected || !t.enviaToken || !t.enviaOrigin) return null;
    return {
      tenantId,
      client: this.clientFactory(open(t.enviaToken, this.boxKey), t.enviaTest),
      test: t.enviaTest,
      origin: t.enviaOrigin as StoredOrigin,
      package: (t.enviaPackage as StoredPackage | null) ?? DEFAULT_PACKAGE,
    };
  }

  /**
   * Secreto con el que se verifica la firma de los webhooks de la tienda: el
   * que la tienda haya pegado o, si no hay, su token de API.
   */
  async webhookSecret(tenantId: string): Promise<string | null> {
    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        enviaConnected: true,
        enviaToken: true,
        enviaWebhookSecret: true,
      },
    });
    if (!t?.enviaConnected) return null;
    const sealed = t.enviaWebhookSecret ?? t.enviaToken;
    return sealed ? open(sealed, this.boxKey) : null;
  }

  /**
   * Convierte ciudad + departamento (como los escribe una persona) en los
   * códigos de Envia: el departamento por nombre y la ciudad por DANE.
   */
  async resolvePlace(
    client: EnviaClient,
    test: boolean,
    city: string,
    state: string | undefined,
  ): Promise<{ cityCode: string; stateCode: string } | null> {
    const candidates = await this.stateCandidates(client, test, city, state);
    for (const stateCode of candidates) {
      const found = await client.locate(city, stateCode);
      if (found)
        return { cityCode: found.city, stateCode: found.state || stateCode };
    }
    return null;
  }

  private async stateCandidates(
    client: EnviaClient,
    test: boolean,
    city: string,
    state: string | undefined,
  ): Promise<string[]> {
    const out: string[] = [];
    const raw = (state ?? '').trim();
    if (/^[A-Z]{2,3}$/.test(raw)) out.push(raw);

    const target = normalizePlaceName(raw);
    if (target) {
      const states = await this.statesFor(client, test);
      const exact = states.find((s) => normalizePlaceName(s.name) === target);
      const partial = states.find((s) => {
        const n = normalizePlaceName(s.name);
        return n.includes(target) || target.includes(n);
      });
      for (const s of [exact, partial]) if (s) out.push(s.code);
    }
    // Bogotá: la documentación de Envia usa tanto DC como CN (Cundinamarca).
    if (
      normalizePlaceName(city).startsWith('bogota') ||
      target.startsWith('bogota')
    ) {
      out.push('DC', 'CN');
    }
    return [...new Set(out)];
  }

  private async statesFor(
    client: EnviaClient,
    test: boolean,
  ): Promise<EnviaState[]> {
    const key = test ? 'test' : 'prod';
    const hit = this.statesCache.get(key);
    if (hit && Date.now() - hit.at < STATES_TTL_MS) return hit.states;
    try {
      const states = await client.states();
      if (states.length > 0)
        this.statesCache.set(key, { at: Date.now(), states });
      return states;
    } catch (err) {
      this.logger.warn(
        `No se pudo leer los departamentos de Envia: ${String(err)}`,
      );
      return hit?.states ?? [];
    }
  }

  private async registerWebhook(
    tenantId: string,
    client: EnviaClient,
  ): Promise<number | null> {
    const base = this.config.get<string>('apiPublicUrl');
    if (!base) {
      this.logger.warn(
        'API_PUBLIC_URL no está configurada: Envia no avisará cambios (queda el job).',
      );
      return null;
    }
    try {
      return await client.createTrackingWebhook(
        `${base}/v1/shipping/envia/webhook/${tenantId}`,
      );
    } catch (err) {
      this.logger.warn(
        `No se pudo registrar el webhook de Envia de ${tenantId}: ${String(err)}`,
      );
      return null;
    }
  }
}
