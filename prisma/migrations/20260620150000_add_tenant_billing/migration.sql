-- CreateEnum: estado de facturación del tenant hacia la plataforma
CREATE TYPE "TenantBillingType" AS ENUM ('SUBSCRIPTION', 'ONE_TIME');
CREATE TYPE "TenantBillingStatus" AS ENUM ('ACTIVE', 'PAST_DUE', 'CANCELLED', 'INACTIVE');
CREATE TYPE "TenantBillingCycle" AS ENUM ('MONTHLY', 'QUARTERLY', 'ANNUAL');

-- AlterTable: Tenant — campos de facturación (gestión manual por superadmin)
ALTER TABLE "Tenant"
  ADD COLUMN "billingType"      "TenantBillingType"   NOT NULL DEFAULT 'SUBSCRIPTION',
  ADD COLUMN "billingStatus"    "TenantBillingStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "billingCycle"     "TenantBillingCycle",
  ADD COLUMN "billingStartedAt" TIMESTAMP(3),
  ADD COLUMN "currentPeriodEnd" TIMESTAMP(3),
  ADD COLUMN "cancelledAt"      TIMESTAMP(3);
