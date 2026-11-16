-- Verificación en dos pasos (TOTP) para operadores
ALTER TABLE "User" ADD COLUMN     "totpSecret" TEXT,
ADD COLUMN     "totpPendingSecret" TEXT,
ADD COLUMN     "totpEnabledAt" TIMESTAMP(3),
ADD COLUMN     "totpLastStep" INTEGER,
ADD COLUMN     "totpRecoveryCodes" TEXT[] DEFAULT ARRAY[]::TEXT[];
