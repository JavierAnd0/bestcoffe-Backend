-- Regla de negocio: un Customer solo puede tener UNA Subscription ACTIVE por variantId.
-- Prisma no soporta índices únicos parciales en el schema, se crea a mano.
CREATE UNIQUE INDEX "Subscription_customer_variant_active_unique"
  ON "Subscription" ("customerId", "variantId")
  WHERE "status" = 'ACTIVE';
