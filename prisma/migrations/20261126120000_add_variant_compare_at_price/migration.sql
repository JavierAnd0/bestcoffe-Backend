-- Precio rebajado: precio "antes" opcional por variante, que la tienda muestra tachado.
-- AlterTable
ALTER TABLE "ProductVariant" ADD COLUMN "compareAtPrice" INTEGER;
