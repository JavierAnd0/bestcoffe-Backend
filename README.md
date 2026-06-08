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

## Endpoints del storefront (Fase 2)

Todos públicos (solo `TenantGuard`), scope por `X-Tenant-Slug`:

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/v1/products` | Catálogo paginado (filtros: tipo, tostado, nota, colección) |
| GET | `/v1/products/:slug` | PDP + reseñas APPROVED + relacionados |
| GET | `/v1/collections` | Colecciones con conteo |
| GET | `/v1/collections/:slug` | Colección resuelta (MANUAL ordenada / AUTO por reglas) |
| GET | `/v1/content/home` | Anuncios, hero, spotlight, bundle (por vigencia) |
| GET | `/v1/blog` · `/v1/blog/:slug` | Posts publicados |
| POST | `/v1/quiz/recommend` | Recomendación por scoring (notas/tostado/tipo/decaf) |
| POST | `/v1/cart/price` | Pricing autoritativo: stock, descuento, envío |
| POST | `/v1/reviews` | Alta de reseña (queda PENDING) |
| GET | `/v1/tenants/current` | Branding + features del tenant |

## Estado

- ✅ **Fase 0** — scaffold, Prisma + schema completo, guards/interceptors,
  módulos esqueleto, auth operador, Swagger, seed, endpoint Inngest.
- ✅ **Fase 2 (backend)** — endpoints del storefront (tabla arriba),
  verificados end-to-end.
- ⬜ **Fase 3** — admin CRUD (productos/variantes/imágenes, colecciones,
  pedidos, suscripciones, contenido, promos, reseñas, config) + revalidación ISR.
- ⬜ **Fase 2/4** — Stripe Connect + checkout + motor de suscripciones (Inngest).
