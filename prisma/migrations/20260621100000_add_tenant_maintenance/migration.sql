-- AlterTable: Tenant — mantenimiento recurrente (pago único) + monto del cobro
ALTER TABLE "Tenant"
  ADD COLUMN "hasMaintenance"     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "billingAmountCents" INTEGER;
