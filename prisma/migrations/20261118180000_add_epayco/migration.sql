-- ePayco (DaviPay) como pasarela de pago por tienda.
ALTER TYPE "PaymentProvider" ADD VALUE 'EPAYCO';

ALTER TABLE "Tenant"
  ADD COLUMN "epaycoCustomerId" TEXT,
  ADD COLUMN "epaycoPKey" TEXT,
  ADD COLUMN "epaycoPublicKey" TEXT,
  ADD COLUMN "epaycoPrivateKey" TEXT,
  ADD COLUMN "epaycoTest" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "epaycoConnected" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Order" ADD COLUMN "epaycoRef" TEXT;

CREATE TABLE "EpaycoEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EpaycoEvent_pkey" PRIMARY KEY ("id")
);
