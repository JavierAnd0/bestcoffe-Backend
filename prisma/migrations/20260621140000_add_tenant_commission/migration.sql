-- AlterEnum: nueva modalidad de cobro por comisión
ALTER TYPE "TenantBillingType" ADD VALUE 'COMMISSION';

-- AlterTable: Tenant — comisión por ventas + flujo de consentimiento
ALTER TABLE "Tenant"
  ADD COLUMN "commissionPct"           DOUBLE PRECISION,
  ADD COLUMN "pendingCommissionPct"    DOUBLE PRECISION,
  ADD COLUMN "commissionPctProposedAt" TIMESTAMP(3),
  ADD COLUMN "commissionAcceptedAt"    TIMESTAMP(3);
