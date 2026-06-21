-- AlterTable: Tenant — habilitación de comisión (se fija al crear el tenant)
ALTER TABLE "Tenant"
  ADD COLUMN "commissionEnabled" BOOLEAN NOT NULL DEFAULT false;
