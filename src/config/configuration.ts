import { createHmac } from 'node:crypto';

export interface AppConfig {
  nodeEnv: string;
  port: number;
  webAppUrl: string;
  platformOwnerEmail: string;
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
  };
  mercadopago: {
    clientId: string;
    clientSecret: string;
    webhookSecret: string;
    redirectUri: string;
    marketplaceFeePct: number;
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
  redisUrl: string;
}

export default (): AppConfig => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3001', 10),
  webAppUrl: process.env.WEB_APP_URL ?? 'http://localhost:3000',
  platformOwnerEmail: process.env.PLATFORM_OWNER_EMAIL ?? '',
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
  resend: {
    apiKey: process.env.RESEND_API_KEY ?? '',
    from: process.env.EMAIL_FROM ?? 'BestCoffee <hola@bestcoffee.io>',
  },
  blob: {
    token: process.env.BLOB_READ_WRITE_TOKEN ?? '',
  },
  inngest: {
    eventKey: process.env.INNGEST_EVENT_KEY ?? '',
    signingKey: process.env.INNGEST_SIGNING_KEY ?? '',
  },
  redisUrl: process.env.REDIS_URL ?? '',
});
