import Joi from 'joi';

/**
 * Validación de entorno al arranque (fail-fast). Si falta un secreto crítico
 * el proceso muere de inmediato en vez de bootear silenciosamente inseguro.
 *
 * Reglas: secretos sin default; el resto puede ausentarse en dev. En
 * producción se exige también lo que rompe seguridad/funcionalidad.
 */
const isProd = process.env.NODE_ENV === 'production';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().default(3001),
  WEB_APP_URL: Joi.string().uri().required(),

  // Datos
  DATABASE_URL: Joi.string().required(),
  DIRECT_URL: Joi.string().optional(),

  // Auth — secreto fuerte SIEMPRE obligatorio (sin fallback inseguro)
  JWT_SECRET: Joi.string().min(32).required(),
  JWT_EXPIRES_IN: Joi.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('30d'),

  // Revalidación backend → front (secreto compartido)
  REVALIDATE_SECRET: isProd
    ? Joi.string().min(16).required()
    : Joi.string().min(16).allow('').optional(),
  WEB_REVALIDATE_URL: Joi.string().uri().allow('').optional(),

  // Pasarelas de pago — opcionales: una tienda puede usar solo MercadoPago.
  // El servicio respectivo falla con 400 si se intenta cobrar sin configurarlo.
  STRIPE_SECRET_KEY: Joi.string().allow('').optional(),
  STRIPE_WEBHOOK_SECRET: Joi.string().allow('').optional(),
  STRIPE_PLATFORM_WEBHOOK_SECRET: Joi.string().allow('').optional(),

  // MercadoPago (marketplace OAuth) — opcionales; cada tienda conecta su cuenta
  MP_CLIENT_ID: Joi.string().allow('').optional(),
  MP_CLIENT_SECRET: Joi.string().allow('').optional(),
  MP_WEBHOOK_SECRET: Joi.string().allow('').optional(),
  MP_REDIRECT_URI: Joi.string().uri().allow('').optional(),
  MP_MARKETPLACE_FEE_PCT: Joi.number().min(0).max(100).optional(),

  RESEND_API_KEY: Joi.string().allow('').optional(),
  EMAIL_FROM: Joi.string().allow('').optional(),
  BLOB_READ_WRITE_TOKEN: Joi.string().allow('').optional(),

  // Inngest
  INNGEST_DEV: Joi.string().allow('').optional(),
  INNGEST_EVENT_KEY: Joi.string().allow('').optional(),
  INNGEST_SIGNING_KEY: isProd
    ? Joi.string().required()
    : Joi.string().allow('').optional(),

  REDIS_URL: Joi.string().allow('').optional(),
  RUN_SEED: Joi.string().allow('').optional(),
  PLATFORM_OWNER_EMAIL: Joi.string().email().allow('').optional(),
});

export const envValidationOptions = {
  // permite vars del sistema no declaradas; reporta TODAS las faltantes juntas
  allowUnknown: true,
  abortEarly: false,
};
