-- Envíos con Envia.com: cuenta por tienda, guías por pedido y avisos de webhook.
-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('LABEL_CREATED', 'IN_TRANSIT', 'DELIVERED', 'EXCEPTION', 'CANCELLED');

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "enviaConnected" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "enviaOrigin" JSONB,
ADD COLUMN     "enviaPackage" JSONB,
ADD COLUMN     "enviaTest" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "enviaToken" TEXT,
ADD COLUMN     "enviaWebhookId" INTEGER,
ADD COLUMN     "enviaWebhookSecret" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "shippingCarrier" TEXT,
ADD COLUMN     "trackingNumber" TEXT;

-- CreateTable
CREATE TABLE "Shipment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'ENVIA',
    "carrier" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "trackingNumber" TEXT NOT NULL,
    "providerShipmentId" TEXT,
    "labelUrl" TEXT,
    "trackingUrl" TEXT,
    "costCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'COP',
    "status" "ShipmentStatus" NOT NULL DEFAULT 'LABEL_CREATED',
    "providerStatus" TEXT,
    "statusDetail" TEXT,
    "lastEventAt" TIMESTAMP(3),
    "lastCheckedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShippingEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShippingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Shipment_tenantId_status_idx" ON "Shipment"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Shipment_orderId_idx" ON "Shipment"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_provider_trackingNumber_key" ON "Shipment"("provider", "trackingNumber");

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

