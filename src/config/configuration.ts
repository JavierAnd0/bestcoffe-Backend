import { createHmac } from 'node:crypto';

export interface AppConfig {
  nodeEnv: string;
  port: number;
  webAppUrl: string;
  /** URL pública de esta API (webhooks de terceros, p. ej. Envia). */
  apiPublicUrl: string;
  platformOwnerEmail: string;
  /** Correo de contacto público de la plataforma (pie de sus correos). */
  platformContactEmail: string;
  databaseUrl: string;
  jwt: {
    secret: string;
    customerSecret: string;
    expiresIn: string;
    refreshExpiresIn: string;
  };
  revalidate: {
    secret: string;
    webUrl: string;
  };
  stripe: {
    secretKey: string;
    webhookSecret: string;
    platformWebhookSecret: string;
    checkoutEnabled: boolean;
  };
  mercadopago: {
    clientId: string;
    clientSecret: string;
    webhookSecret: string;
    redirectUri: string;
    marketplaceFeePct: number;
  };
  epayco: {
    confirmationUrl: string;
  };
  resend: {
    apiKey: string;
    from: string;
  };
  blob: {
    token: string;
  };
  inngest: {
    eventKey: string;
    signingKey: string;
  };
  turnstile: {
    secretKey: string;
  };
  redisUrl: string;
}

export default (): AppConfig => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3001', 10),
  webAppUrl: process.env.WEB_APP_URL ?? 'http://localhost:3000',
  apiPublicUrl: (process.env.API_PUBLIC_URL ?? '').replace(/\/+$/, ''),
  platformOwnerEmail: process.env.PLATFORM_OWNER_EMAIL ?? '',
  platformContactEmail: process.env.PLATFORM_CONTACT_EMAIL ?? '',
  // Garantizados por envValidationSchema (Joi) en el arranque.
  databaseUrl: process.env.DATABASE_URL as string,
  jwt: {
    secret: process.env.JWT_SECRET as string,
    // Secreto distinto para tokens de cliente, derivado del principal via HMAC.
    // Garantiza que un token de cliente NUNCA valide como token de operador/
    // plataforma (firmas incompatibles), sin requerir una env var extra.
    customerSecret: createHmac('sha256', process.env.JWT_SECRET ?? '')
      .update('bestcoffee:customer-token:v1')
      .digest('hex'),
    expiresIn: process.env.JWT_EXPIRES_IN ?? '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '30d',
  },
  revalidate: {
    secret: process.env.REVALIDATE_SECRET ?? '',
    webUrl: process.env.WEB_REVALIDATE_URL ?? '',
  },
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY ?? '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
    platformWebhookSecret: process.env.STRIPE_PLATFORM_WEBHOOK_SECRET ?? '',
    // Stripe cobra en UNA cuenta (la de la plataforma): sin Connect, el dinero
    // de una tienda caería ahí. Por eso el checkout con Stripe está apagado
    // salvo que se active a propósito (solo para pruebas de la plataforma).
    checkoutEnabled: process.env.STRIPE_CHECKOUT_ENABLED === '1',
  },
  mercadopago: {
    // Credenciales de TU aplicación MercadoPago (marketplace). Las tiendas
    // conectan su cuenta vía OAuth; nunca guardamos credenciales de la app
    // del vendedor, solo sus tokens OAuth.
    clientId: process.env.MP_CLIENT_ID ?? '',
    clientSecret: process.env.MP_CLIENT_SECRET ?? '',
    webhookSecret: process.env.MP_WEBHOOK_SECRET ?? '',
    redirectUri: process.env.MP_REDIRECT_URI ?? '',
    marketplaceFeePct: parseFloat(process.env.MP_MARKETPLACE_FEE_PCT ?? '0'),
  },
  epayco: {
    // URL pública del aviso servidor a servidor de ePayco
    // (https://<api>/v1/epayco/confirmation). Sin ella, el pedido se confirma
    // al volver el comprador (sync) o con la URL configurada en el panel de
    // ePayco. Las llaves NO van aquí: cada tienda pega las suyas.
    confirmationUrl: process.env.EPAYCO_CONFIRMATION_URL ?? '',
  },
  resend: {
    apiKey: process.env.RESEND_API_KEY ?? '',
    from: process.env.EMAIL_FROM ?? 'Bestkofi <hola@bestcoffee.io>',
  },
  blob: {
    token: process.env.BLOB_READ_WRITE_TOKEN ?? '',
  },
  inngest: {
    eventKey: process.env.INNGEST_EVENT_KEY ?? '',
    signingKey: process.env.INNGEST_SIGNING_KEY ?? '',
  },
  turnstile: {
    secretKey: process.env.TURNSTILE_SECRET_KEY ?? '',
  },
  redisUrl: process.env.REDIS_URL ?? '',
});
