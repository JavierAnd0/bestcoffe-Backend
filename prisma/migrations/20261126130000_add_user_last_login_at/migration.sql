-- Último inicio de sesión de cada operador (para mostrar "Aún no entra" en Equipo).
ALTER TABLE "User" ADD COLUMN "lastLoginAt" TIMESTAMP(3);
