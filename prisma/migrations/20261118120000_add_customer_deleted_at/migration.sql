-- Cuenta de cliente eliminada ("Eliminar mi cuenta"): la fila se anonimiza y
-- queda marcada; el guard rechaza sus sesiones.
ALTER TABLE "Customer" ADD COLUMN     "deletedAt" TIMESTAMP(3);
