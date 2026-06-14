-- Add storefront auth fields to Customer

ALTER TABLE "Customer"
  ADD COLUMN "passwordHash"         TEXT,
  ADD COLUMN "emailVerified"        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "emailVerifyToken"     TEXT,
  ADD COLUMN "emailVerifyExpiresAt" TIMESTAMP(3);
