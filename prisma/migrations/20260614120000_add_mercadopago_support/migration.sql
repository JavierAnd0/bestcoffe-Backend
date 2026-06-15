-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('STRIPE', 'MERCADOPAGO');

-- AlterTable: Tenant — proveedor de pago + credenciales MercadoPago (OAuth)
ALTER TABLE "Tenant"
  ADD COLUMN "paymentProvider"  "PaymentProvider" NOT NULL DEFAULT 'STRIPE',
  ADD COLUMN "mpUserId"         TEXT,
  ADD COLUMN "mpAccessToken"    TEXT,
  ADD COLUMN "mpRefreshToken"   TEXT,
  ADD COLUMN "mpPublicKey"      TEXT,
  ADD COLUMN "mpTokenExpiresAt" TIMESTAMP(3),
  ADD COLUMN "mpConnected"      BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: Order — id del pago de MercadoPago
ALTER TABLE "Order"
  ADD COLUMN "mpPaymentId" TEXT;

-- CreateTable: idempotencia de webhooks de MercadoPago
CREATE TABLE "MercadoPagoEvent" (
  "id"          TEXT NOT NULL,
  "type"        TEXT NOT NULL,
  "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MercadoPagoEvent_pkey" PRIMARY KEY ("id")
);
