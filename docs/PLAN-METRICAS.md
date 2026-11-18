# BestCoffee · Plan de métricas y analítica

Plan para pasar de "foto del momento" a analítica con historia en los dos
paneles. Cubre `bestcoffe-Backend` (API) y `BestCoffee` (front).

**Creado:** 2026-11-17 · **Estado:** Fase A hecha y verificada en local (rama `feat/metricas` en ambos repos), sin commitear ni desplegar.

Convenciones de `PLAN-CIERRE.md`: `[ ]` abierto, `[~]` verificado en local,
`[x]` en `main` y desplegado.

---

## 0. Punto de partida

| Panel | Hoy | Límite |
|---|---|---|
| Tienda `/admin` | 4 KPIs, barras de ventas diarias, alertas, lista de clientes | Sin rangos, sin comparación, sin suscripciones/productos/clientes en profundidad |
| Superadmin `/platform/superadmin` | MRR, tiendas activas, clientes, pedidos, listas | Calculado en el front desde `/v1/platform/tenants`; MRR con tarifa fija por plan (`TIER_MRR_COP`) aunque existe `Tenant.billingAmountCents`; sin series en el tiempo |

### Huecos de datos que condicionan el plan

1. **Sin historial de estados de pedido.** Solo `Order.updatedAt` → no se puede
   medir tiempo de despacho.
2. **Sin historial de suscripciones.** No hay `cancelledAt`/`pausedAt` → el churn
   mensual no es exacto.
3. **Sin historial de facturación del tenant.** Solo el estado actual (hay
   `cancelledAt`, pero no altas/bajas de MRR por mes).
4. **Sin visitas.** No hay eventos de storefront → no hay tasa de conversión.
5. **Sin registro de comisiones cobradas.** Se pueden *estimar* (`commissionPct
   × GMV`), no conciliar.

La Fase A trabaja solo con los datos que ya existen. Las fases B y C agregan las
tablas de eventos.

---

## 1. Panel de la tienda — `/admin/metricas`

Lo que necesita un tostador / café de especialidad: **cuánto vendo, cuánto
retengo en suscripción, qué café tostar y quién se me está yendo.**

### 1.1 Ventas (pestaña "Ventas")

- Ingresos netos = pagados − reembolsados, pedidos, **ticket promedio**.
- Comparación con el periodo anterior (Δ % en cada KPI).
- Serie diaria/semanal/mensual apilada por `Order.source`:
  compra suelta · renovación de suscripción · regalo.
- Descuentos otorgados (`discountCents`) y % sobre ventas brutas.
- Pedidos **pendientes de pago** con antigüedad (clave en el modelo "cobro por
  fuera": transferencia / contra entrega).
- Cancelaciones y reembolsos del periodo.

### 1.2 Suscripciones (pestaña "Suscripciones") — el corazón del negocio

- Activas, pausadas, con pago fallido.
- **MRR de suscripciones** = Σ precio de la variante × (30 / `frequencyDays`) ×
  (1 − `discountPct`).
- Altas y bajas por mes, churn %, distribución por frecuencia (7/14/30 días).
- **Plan de tueste:** kg a despachar en los próximos 7 y 14 días según
  `nextShipAt` × `sizeGrams`, por producto y molienda. Es la métrica más
  accionable para el operador.
- Retención por cohorte (mes de alta → % activas a 1, 3 y 6 meses). Necesita la
  Fase B para ser exacta.

### 1.3 Productos (pestaña "Productos")

- Top productos/variantes por ingresos y por unidades (`OrderItem`).
- Mezcla de **molienda** y **tamaño** más pedidos.
- **Días de inventario:** `stock` / ventas diarias promedio de 30 días, con
  alerta < 7 días (mejor que el umbral fijo de "stock bajo").
- Calificación promedio y número de reseñas por producto.

### 1.4 Clientes (pestaña "Clientes")

- Nuevos vs recurrentes en el periodo, **tasa de recompra**.
- LTV promedio (ingreso total / clientes con ≥1 pedido pagado).
- **Clientes en riesgo:** sin compra en más de 2× su intervalo habitual entre
  pedidos, sin suscripción activa. Lista exportable.
- Crecimiento de la newsletter (altas − `unsubscribedAt`).
- Carritos abandonados: `CartItem` de más de 24 h sin pedido posterior, con su
  valor (solo clientes con cuenta).

### 1.5 Promociones

- Por código: canjes, ingresos de los pedidos con ese código, descuento total.

### 1.6 Acceso por plan

| Plan | Qué ve |
|---|---|
| STARTER | Newsletter y reseñas; resto bloqueado con CTA de upgrade (no tiene checkout) |
| PRO | Ventas, Productos, Clientes, Suscripciones básicas, Promociones |
| BUSINESS | + cohortes, plan de tueste, clientes en riesgo, exportar CSV, regalos |

Nueva feature `advancedAnalytics` en `TIER_FEATURES` (BUSINESS por defecto, se
puede activar por tienda vía `Tenant.features`). Roles: TENANT_OWNER y
TENANT_EDITOR; TENANT_ORDERS solo ve plan de tueste y pendientes de pago.

---

## 2. Panel de la plataforma — `/platform/superadmin/metricas`

Lo que necesitas como dueño del SaaS: **ingresos reales, crecimiento, qué
tiendas se van a caer y a cuáles venderles un upgrade.**

### 2.1 Ingresos (pestaña "Ingresos")

- **MRR real:** `billingAmountCents` normalizado por `billingCycle`
  (trimestral ÷ 3, anual ÷ 12) para tiendas `ACTIVE` con `SUBSCRIPTION` o
  mantenimiento. Reemplaza `TIER_MRR_COP`.
- ARR, ingresos de pago único del periodo.
- **Comisiones devengadas:** `commissionPct` × GMV pagado de cada tienda con
  comisión, por mes.
- Ingreso total de la plataforma = MRR + comisiones + pagos únicos, serie mensual.
- MRR por plan (STARTER/PRO/BUSINESS) y por tipo de cobro.

### 2.2 Crecimiento y churn (pestaña "Tiendas")

- Tiendas nuevas por mes (`createdAt`), por plan.
- Cancelaciones por mes (`cancelledAt`), churn de tiendas %.
- Movimiento de MRR (nuevo · expansión · contracción · perdido). Necesita la
  Fase C.

### 2.3 GMV (lo que venden las tiendas)

- GMV total y por tienda, serie mensual, ticket promedio de la red.
- Take rate = ingreso de la plataforma / GMV.
- Ranking de tiendas por GMV y por crecimiento.

### 2.4 Salud de cada tienda (puntaje 0–100)

Señales que ya existen:

- Pedidos de los últimos 30 días frente a los 30 anteriores.
- Días desde el último pedido.
- **Actividad del operador:** último `AuditLog.createdAt` de la tienda.
- Configuración completa: pasarela conectada (`mpConnected`/Stripe), dominio
  verificado, productos publicados.
- Estado de facturación (mora, `PAST_DUE`).

Resultado: lista "en riesgo" ordenada y un semáforo en la tabla de tenants.

### 2.5 Adopción y oportunidades de upgrade

- % de tiendas que usan cada feature: suscripciones, regalos, códigos, blog,
  guías, dominio propio.
- **Candidatas a upgrade:** STARTER con ≥80 % de `maxProducts` o con tráfico de
  "contáctanos"; PRO con GMV alto o que pidió regalos/dominio.

### 2.6 Cobranza

- Vencidos con días de mora y monto, próximos cobros a 30 días con monto
  (usando `billingAmountCents`, no la tarifa fija).

### 2.7 Salud técnica (liviano)

- Pagos fallidos por tienda y eventos de webhook (`StripeEvent`,
  `MercadoPagoEvent`) por día, para detectar una integración rota.

---

## 3. Arquitectura

### Backend

- Módulo nuevo `src/modules/analytics/`:
  - `admin-analytics.controller.ts` → `v1/admin/analytics/{sales,subscriptions,products,customers,promotions,roast-plan}`
    (AuthGuard + TenantGuard + RolesGuard + `@RequireFeature` donde aplique).
  - `platform-analytics.controller.ts` → `v1/platform/analytics/{revenue,growth,gmv,health,adoption}` (PlatformGuard).
- Parámetros comunes: `from`, `to`, `granularity=day|week|month`, `compare=true`.
  DTO validado; rango máximo de 366 días.
- Consultas con `$queryRaw` + `date_trunc(... AT TIME ZONE 'America/Bogota')`
  para que los días cuadren con Colombia y no con UTC.
- Índice nuevo: `Order(tenantId, paymentStatus, createdAt)`; revisar
  `Subscription(tenantId, status)` y `OrderItem(tenantId, variantId)`.
- Respuesta estándar `{ current, previous?, series[] }` en centavos COP.

### Snapshots (para escalar y para tener historia)

- Tabla `MetricSnapshot { scope: TENANT|PLATFORM, tenantId?, date, metrics Json }`.
- Cron diario en **Inngest** (el módulo ya existe) que guarda MRR, suscripciones
  activas, GMV del día, etc. Da historia de MRR/estado aunque no haya tabla de
  eventos, y las vistas mensuales del superadmin leen de aquí en vez de recorrer
  todos los pedidos.

### Front

- Rutas: `app/admin/metricas/` y `app/platform/superadmin/metricas/` con
  pestañas y un selector de rango (7 d · 30 d · 90 d · 12 m · personalizado).
- Reemplazar el SVG de `components/admin/sales-chart.tsx` por Recharts (el
  comentario del archivo ya lo anticipa): líneas, barras apiladas, donut de
  molienda.
- Fetchers en `lib/data/analytics.ts` con el mismo patrón `adminFetch` /
  `platformFetch`. Estado vacío explícito, **sin caer a datos de ejemplo**.
- Exportar CSV (BUSINESS) desde el backend: `?format=csv`.
- El inicio del superadmin pasa a leer el MRR del endpoint nuevo.

---

## 4. Fases

### Fase A · Con los datos actuales

Backend

- [~] Módulo `analytics` + DTO de rango + utilidades de zona horaria
- [~] `admin/analytics/sales` (con comparación y desglose por origen)
- [~] `admin/analytics/subscriptions` (activas, MRR, frecuencias) + `roast-plan`
- [~] `admin/analytics/products` (top, molienda/tamaño, días de inventario)
- [~] `admin/analytics/customers` (nuevos/recurrentes, recompra, LTV, en riesgo)
- [~] `platform/analytics/revenue` (MRR real, comisiones estimadas, ARR)
- [~] `platform/analytics/gmv` + `growth` (altas/cancelaciones por mes)
- [~] `platform/analytics/health` (puntaje por tienda)
- [~] Feature `advancedAnalytics` en `TIER_FEATURES` (también en el formulario de overrides del superadmin)
- [~] Índice en `Order` + tests e2e de cada endpoint (aislamiento por tenant). Migración `20261117200000_add_order_analytics_index` aplicada en Neon el 2026-11-17.

Front

- [~] Gráfico de columnas propio (sin Recharts, ver decisiones) + componente de rango + tarjetas KPI con Δ
- [~] `/admin/metricas` con 5 pestañas (incluye Plan de tueste) y bloqueo por plan y rol
- [~] `/platform/superadmin/metricas` con Ingresos / Ventas de las tiendas / Altas y bajas / Salud
- [ ] Semáforo de salud en la tabla de tenants (la salud ya está en Métricas → Salud)
- [~] Quitar `TIER_MRR_COP` del inicio del superadmin

### Fase B · Eventos de la tienda (precisión)

- [ ] `OrderStatusEvent` (o `shippedAt`/`deliveredAt` en `Order`) → tiempo de
      despacho y SLA
- [ ] `SubscriptionEvent` (alta, pausa, reanudación, cancelación, pago fallido)
      → churn exacto y cohortes reales
- [ ] Carritos abandonados + promociones con atribución
- [ ] Exportar CSV

### Fase C · Historia de la plataforma

- [ ] `MetricSnapshot` + cron diario en Inngest
- [ ] Movimiento de MRR (nuevo · expansión · contracción · perdido)
- [ ] Adopción de features y candidatas a upgrade
- [ ] `PlatformCharge` para conciliar comisiones y cobros reales

### Fase D · Tráfico (opcional)

- [ ] Eventos livianos del storefront (vista de producto, añadir al carrito,
      checkout iniciado) o integrar Vercel Web Analytics → embudo y conversión

---

## 5. Decisiones abiertas

1. ¿La Fase A va en una sola PR por repo o en una por panel?
2. ¿Qué se muestra en STARTER: bloqueo con CTA o métricas mínimas?
3. ¿Precio del plan en `billingAmountCents` para todas las tiendas? (Si hay
   tiendas sin ese valor, el MRR real queda corto: mostrar "sin monto" en vez de
   usar la tarifa fija.)
4. ¿Tráfico propio (Fase D) o una herramienta externa?

### Decisiones tomadas en la Fase A

- **STARTER:** la página muestra un bloqueo con explicación (no vende, no hay qué medir).
- **Sin Recharts:** gráfico de columnas apiladas propio, con tooltip, leyenda con totales y vista de tabla. Mantiene el panel sin dependencias y pasa la validación de color para daltonismo (azul, naranja y aqua; el aqua lleva leyenda y tabla por contraste).
- **Rol Pedidos (TENANT_ORDERS):** ve Métricas solo con la pestaña Plan de tueste.
- **Plan de tueste:** cuenta los envíos de suscripción con su frecuencia más los pedidos recibidos o en preparación (pagados o por cobrar). Accesorios fuera.
- **MRR:** recurrente = suscripción o mantenimiento; `PAST_DUE` suma (sigue siendo cliente), suspendidas no. Tiendas recurrentes sin monto se listan aparte en vez de estimarlas.
- **Churn de suscripciones:** aproximado con `updatedAt` de las canceladas hasta la Fase B.

## Registro

| Fecha | Cambio |
|---|---|
| 2026-11-17 | Plan creado |
| 2026-11-17 | Fase A en local: backend 303 unitarias + 48 e2e (12 nuevas de analítica) en verde, lint y build; front tsc, lint y `next build` en verde; páginas revisadas contra la tienda `demo` de la base local de pruebas |
| 2026-11-17 | Neon: migración del índice aplicada; tarifas indicativas mensuales cargadas (origen y cafe-prueba $200.000, demo $450.000) para que el MRR real no salga en $0 |
