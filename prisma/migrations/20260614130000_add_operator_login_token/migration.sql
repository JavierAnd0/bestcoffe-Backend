-- AlterTable: User — magic link de login para operadores
ALTER TABLE "User"
  ADD COLUMN "loginToken"          TEXT,
  ADD COLUMN "loginTokenExpiresAt" TIMESTAMP(3);
