-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "passwordResetToken" TEXT,
ADD COLUMN     "passwordResetExpiresAt" TIMESTAMP(3);

