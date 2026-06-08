# BestCoffee API

Backend multi-tenant de la plataforma SaaS de café de especialidad (módulos:
tienda pública, panel admin, motor de suscripciones). Consumido por el front
`BestCoffee-web` (Next.js) vía REST + OpenAPI.

## Stack

- **NestJS 11** + TypeScript
- **Prisma 7** + PostgreSQL (Neon en prod, Postgres.app en local) — driver adapter `pg`
- **@nestjs/swagger** → OpenAPI en `/docs` y `/docs-json`
- **passport-jwt / @nestjs/jwt** — sesión de operador y cliente (JWT compartido con el front)
- **Stripe** (Connect Express), **Resend** (emails), **Inngest** (jobs), **Vercel Blob** (uploads)
- **nestjs-cls** (AsyncLocalStorage) para el contexto multi-tenant
- **nestjs-pino** logging estructurado

## Arquitectura multi-tenant

- El front envía `X-Tenant-Slug` en cada request.
- `TenantGuard` resuelve el slug → `tenantId` (cache TTL) y lo inyecta en el
  request + store CLS.
- Toda query de negocio filtra por `tenantId`.
- `AuthGuard` valida el `Bearer <jwt>` (rutas no `@Public`).
- `RolesGuard` revisa `TenantMembership.role` contra `@Roles(...)`.
- `AuditInterceptor` escribe `AuditLog` en cada mutación admin.

## Setup local

Requiere Node 20+, pnpm y un Postgres local (o Neon).

```bash
pnpm install
cp .env.example .env        # ajustar DATABASE_URL / DIRECT_URL
pnpm db:migrate             # aplica migraciones
pnpm db:seed                # tenant "origen" + 6 productos + cliente + sub
pnpm start:dev              # API en http://localhost:3001
```

- Swagger UI: http://localhost:3001/docs
- OpenAPI JSON (para el SDK del front): http://localhost:3001/docs-json
- Health: http://localhost:3001/health

### Datos de demo (seed)

- Tenant: `origen` (tier PRO)
- Operador: `operador@origen.co` (login passwordless de dev)
- Cliente: `cliente@demo.co`

```bash
# catálogo del tenant
curl -H "X-Tenant-Slug: origen" localhost:3001/v1/products

# login operador → JWT
curl -X POST localhost:3001/v1/auth/login \
  -H "Content-Type: application/json" -d '{"email":"operador@origen.co"}'
```

## Scripts

| Script | Acción |
|---|---|
| `pnpm start:dev` | API en watch |
| `pnpm build` | compila a `dist/` |
| `pnpm db:migrate` | `prisma migrate dev` |
| `pnpm db:deploy` | `prisma migrate deploy` (prod) |
| `pnpm db:seed` | siembra datos demo |
| `pnpm db:studio` | Prisma Studio |
| `pnpm test` | unit (Jest) |

## Notas Prisma 7

- La config (schema, migraciones, seed, datasource de la CLI) vive en
  `prisma.config.ts`, **no** en el bloque `datasource` (ya no acepta `url`).
- El runtime usa el **driver adapter** `@prisma/adapter-pg` (ver
  `src/prisma/prisma.service.ts`).
- El índice único parcial "una suscripción `ACTIVE` por (customer, variant)"
  se crea en una migración SQL manual (Prisma no lo soporta en el schema).

## Estado

- ✅ **Fase 0** — scaffold, Prisma + schema completo, guards/interceptors,
  módulos esqueleto, `GET /v1/products` + PDP, auth operador, Swagger, seed,
  endpoint Inngest. Verificado end-to-end.
- ⬜ Fases 1–6 — ver el plan del proyecto.
