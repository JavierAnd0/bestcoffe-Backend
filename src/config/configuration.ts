export interface AppConfig {
  nodeEnv: string;
  port: number;
  webAppUrl: string;
  databaseUrl: string;
  jwt: {
    secret: string;
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
  databaseUrl: process.env.DATABASE_URL ?? '',
  jwt: {
    secret: process.env.JWT_SECRET ?? 'dev-insecure-secret',
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
