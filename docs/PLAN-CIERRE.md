# BestCoffee · Control del plan de cierre

Registro único de qué está abierto y qué cerrado para llevar la plataforma a una
demo real en producción. Cubre los dos repos: `bestcoffe-Backend` (API) y
`BestCoffee` (front).

**Última actualización:** 2026-11-15 (tras la revisión de código y de seguridad del lote)

## Cómo usar este archivo

- Un ítem se marca `[x]` solo cuando está **verificado** (prueba, CI en verde o
  comprobación real), no cuando el código está escrito.
- `[~]` = hecho y verificado **en local, sin commitear ni desplegar**. Pasa a
  `[x]` cuando esté en `main` y desplegado.
- Cada cierre añade una línea al [Registro](#registro) con fecha y evidencia.
- Lo que aparece sin planearlo va a [Hallazgos abiertos](#hallazgos-abiertos).

## Estado de producción

| Pieza | Dónde | Estado |
|---|---|---|
| Tienda ORÍGEN | https://bestcoffee-nine.vercel.app | En línea (versión anterior a este lote) |
| API | https://bestcoffee-api.vercel.app (`/health`) | En línea (versión anterior a este lote) |
| Base de datos | Neon | Compartida entre producción y desarrollo local |
| Despliegue backend | Vercel, automático desde `main` | Funcionando |
| Despliegue front | Vercel, conectado a GitHub | `main` aún sin `vercel.json`; se desplegó a mano |

Decisiones vigentes: backend en Vercel mientras sea demo y a **Dokploy** con el
primer cliente de pago; un solo front compartido que resuelve la tienda por
dominio; "pedidos sin pagos" = el cliente hace el pedido y se cobra por fuera
(transferencia / contra entrega), el operador lo marca como pagado.

**Orden de despliegue de este lote:** primero el backend (trae `/v1/orders/guest`
y las features nuevas), después el front. No hay migraciones de base de datos
nuevas. Variables nuevas, todas opcionales: `PLATFORM_DOMAIN`,
`TOKEN_ENCRYPTION_KEY`, `STRIPE_CHECKOUT_ENABLED`.

## Etapa 1 · Cerrar la base

- [x] Backend fusionado en `main` y desplegado automáticamente
- [x] Proyectos de Vercel conectados a GitHub
- [x] Dominio de plataforma configurable (`NEXT_PUBLIC_PLATFORM_DOMAIN` / `PLATFORM_DOMAIN`)
- [x] CORS sin el fallo de "dos últimas etiquetas del dominio"
- [~] Pruebas e2e del front arregladas: 38 pasan y 1 se omite de forma explícita en modo mocks (`e2e/env.ts`)
- [~] Valores por defecto inseguros fuera: `REVALIDATE_SECRET` y `NEON_AUTH_COOKIE_SECRET` son obligatorios en producción
- [~] Documentación unificada (README de ambos repos y `STARTER_TEMPLATE.md`)
- [ ] Commitear y subir los cambios del front y fusionar su PR: https://github.com/JavierAnd0/BestCoffee/pull/2
- [ ] Rama `dev` en Neon para el desarrollo local (consola de Neon)
- [ ] Añadir el dominio del sitio en Neon Auth (login con Google en producción)
- [ ] Igualar la versión de Node: Vercel usa 26, el CI y el Dockerfile 22 (ajuste del proyecto en Vercel)

## Etapa 2 · Features de verdad

- [x] "Pedidos sin pagos" definido: pedido recibido, pago por fuera, el operador lo marca pagado
- [~] Catálogo de features único en el backend (`tier-features.ts`) con `accessories` y `onlinePayments` nuevas; el front ya no copia la tabla por tier
- [~] Bloqueo en la API (402): blog, catálogo, colecciones, quiz, carrito, cupones, reseñas, regalos, cuentas, suscripciones y checkout
- [~] Accesorios y cupones se aplican dentro de los servicios, no solo en los controladores
- [~] Pedidos sin pagos en línea: la orden queda pendiente; marcarla pagada liquida inventario, cupón y correo (idempotente). Solo desde un estado válido: se rechaza en pedidos cancelados o reembolsados
- [~] MercadoPago elegido pero sin cuenta conectada deja el pedido manual en vez de FALLIDO
- [~] Accesorios apagados: tampoco se cotizan, compran, recomiendan ni aparecen en relacionados o colecciones
- [~] La tienda y el panel `/admin` ocultan menús, enlaces y páginas de lo que el plan no incluye
- [~] Un test por feature (apagada = 402, encendida = pasa) y una tabla que falla si un controlador pierde su protección

## Etapa 3 · Aislamiento y secretos

- [~] Suite de aislamiento con dos tiendas completas contra Postgres real: 24 pruebas, ninguna fuga encontrada (catálogo, blog, carrito, cupones, pedidos, sesión de cliente, panel, dominios)
- [~] La suite corre en el CI del backend (Postgres como servicio)
- [~] Tokens de MercadoPago cifrados (AES-256-GCM). Los guardados en texto plano siguen funcionando y se cifran solos al refrescar. Cambiar `JWT_SECRET` invalida los cifrados y obliga a reconectar MercadoPago

## Etapa 4 · Marca y contenido por tienda

- [x] Títulos de página sin la marca escrita a mano
- [~] `branding` aplicado: logo, color de acento, lema, contacto, ciudad, razón social y NIT; formulario "Marca y contenido" en el superadmin
- [~] Contacto, factura, textos legales, blog, login, registro y títulos usan los datos de cada tienda; lo no cargado se omite
- [~] Sitemap y `llms.txt` solo listan las páginas editoriales que la tienda tiene
- [~] Hero 3D como opción de ORÍGEN; el resto usa hero clásico (sin JavaScript de cliente)
- [~] Historia, impacto, sostenibilidad, mayoristas y sedes solo existen para tiendas que las activan; para las demás son 404
- [~] La tienda `demo` no muestra "ORÍGEN" en ninguna de las páginas revisadas
- [ ] Editor para que cada tienda escriba su propia historia, impacto y sedes (hoy son contenido de ORÍGEN en el código)

## Etapa 5 · Cobro

- [~] Tienda `CANCELLED` / `INACTIVE`: la API responde 402, el sitio muestra "Tienda no disponible" con `noindex`, y sitemap, `robots.txt` y `llms.txt` quedan vacíos; `PAST_DUE` solo avisa en `/admin`
- [~] Las renovaciones de suscripción no cobran a tiendas suspendidas ni sin la capacidad `subscriptions`
- [~] Comisión por tienda aplicada al pago de MercadoPago (antes usaba un % global)
- [~] Stripe apagado como pasarela de tiendas hasta implementar Connect (`STRIPE_CHECKOUT_ENABLED=1` solo para pruebas de plataforma)
- [~] El checkout deja de mostrar campos de tarjeta si no hay una pasarela real conectada
- [~] Normalizado `paymentProvider` ("MERCADOPAGO" llegaba en mayúsculas y los campos de MercadoPago nunca aparecían)
- [ ] Webhook de MercadoPago apuntando a la API de producción
- [ ] Dominio verificado en Resend (hoy `onboarding@resend.dev`, solo entrega a tu correo)
- [ ] Claves reales de Inngest confirmadas en producción

## Etapa 6 · Dominio

- [x] Proxy sin inferir la tienda del primer segmento de un dominio ajeno
- [~] Dominio propio por `TenantDomain`: solo enruta cuando está VERIFICADO por registro TXT; CORS solo abre dominios verificados; gestión en el superadmin
- [ ] Comprar dominio y configurar comodín `*.dominio` en Vercel
- [ ] Probar un dominio propio de cliente real de punta a punta (el DNS no se puede simular en local)

## Etapa 7 · Demo con interruptores

- [~] Tienda `demo` sandbox con contenido de ejemplo (`scripts/seed-demo-tenant.ts`); ya está sembrada en la base compartida
- [~] Panel "Arma tu tienda": presets (solo landing, catálogo, pedidos, completa) e interruptores, con estado propio de cada visitante (cookie de 1 día)
- [~] El override lo acepta el backend solo en tiendas sandbox; los pagos en línea están siempre apagados en la demo
- [ ] Desplegar y servir la demo en `demo.<dominio>` (necesita el dominio de la etapa 6)

## Etapa 8 · Migrar a Dokploy

- [ ] Pendiente hasta el primer cliente de pago

## Fuera del plan original

- [x] Despliegue de front y backend en Vercel
- [x] Fix de `dist/main.js` (el build compilaba a `dist/src/`)
- [~] Estado de carga del hero 3D, scroll sin desenfoques, caché de modelos de 5 minutos
- [~] SEO por tienda: robots, sitemap, `llms.txt`, metadatos, imagen para compartir, datos estructurados
- [~] Los 10 hallazgos de la revisión de código aplicados
- [~] `listProducts` recorre todas las páginas de la API (el catálogo solo mostraba las primeras 24)
- [ ] Registrar el sitio en Google Search Console y enviar el sitemap

## Hallazgos abiertos

| Hallazgo | Dónde | Estado |
|---|---|---|
| Toma de cuenta por checkout de invitado | Front `order.ts` | `[~]` Corregido: endpoint `/v1/orders/guest` sin sesión. **Sigue abierto en producción hasta desplegar** |
| Toma de cuenta por cookie de Neon sin verificar | Front `session-store.ts` | `[~]` Corregido: identidad solo desde el SDK o Neon Auth, y `/cuenta` exige sesión real. **Sigue abierto en producción hasta desplegar** |
| Borrado de imágenes sin autorización real | Front `product-images.ts` | `[~]` Corregido: valida el token contra el backend y solo toca `products/` |
| Subida de imágenes sin autorización real | Front `blob-upload/route.ts` | `[~]` Corregido: valida el token contra el backend |
| Sesión local de operador sin firma (`.local_operator_session`) | Front `operator-auth.ts` | Abierto, riesgo bajo: el backend rechaza sus peticiones, pero muestra el panel de superadmin vacío |
| Los 19 hallazgos de la revisión de código (backend 10, front 9) | Ambos repos | `[~]` Corregidos los de comportamiento incorrecto y los de rendimiento (paginación de 100, sesión memoizada, proxy sin consulta para `*.vercel.app`, layout del admin en paralelo). Queda abierto: `/cuenta/*` redirige al login sin conservar la subpágina (`next`) |
| Pedido de invitado con el correo de una cuenta real | Backend `createGuest` | `[~]` Responde 409 "inicia sesión" si el correo es de una cuenta con contraseña o verificada; con esto un tercero ya no puede colgar pedidos ni gastar cupones ajenos. Efecto secundario: permite saber si un correo tiene cuenta |
| Rotar `JWT_SECRET` deja ilegibles los tokens de MercadoPago | Backend | `[~]` El arranque en producción avisa si falta `TOKEN_ENCRYPTION_KEY`. **Falta definirla en Vercel** (no se exige para no impedir el arranque) |
| Reseñas escritas a mano ("5 estrellas, 128 reseñas") | Front, ficha de producto | Abierto. El backend ya recibe, modera y publica reseñas; falta el formulario y mostrarlas, y exigir un pedido pagado |
| Imágenes de demo en servicios externos con errores 504 | Front, catálogo | Abierto |
| El build falla a veces al descargar Google Fonts | Front | Abierto |
| Vistas previas de Vercel sin variables de entorno | Ambos proyectos | Abierto |
| Límite de peticiones y cachés en memoria por instancia | Backend en Vercel | Abierto; se resuelve en Dokploy |
| La landing de la plataforma usa el título "ORÍGEN" | Front | Abierto |
| `PLATFORM_OWNER_EMAIL` cargado en Vercel desde `.env.local` | Ambos proyectos | Revisar que sea el correo correcto |
| `EMAIL_FROM` local con una comilla suelta; `REDIS_URL` apunta a un marcador | Backend `.env` | Abierto |
| Proyecto `bestcoffee` vacío en Railway | Railway | Se puede borrar |
| El login con Google no se probó tras corregir la identidad de Neon | Front | Abierto: verificarlo en producción tras desplegar |
| Los datos de la demo (tienda `demo`, branding de ORÍGEN) se escribieron en la base compartida con producción | Neon | Informativo |
| Revisión de código y de seguridad del lote | Ambos repos | Hechas: la de seguridad no encontró vulnerabilidades de alta confianza |

## Registro

| Fecha | Qué se cerró | Evidencia |
|---|---|---|
| 2026-11-14 | Home roto: backend apagado y build a `dist/src/` | commit `1bb7614` |
| 2026-11-14 | Auditoría de seguridad, newsletter y accesorios en `main` (backend) | https://github.com/JavierAnd0/bestcoffe-Backend/pull/1 |
| 2026-11-14 | CORS con dominio de plataforma configurable | commit `789004d` |
| 2026-11-14 | Proxy con dominio configurable, sin slug inferido | commit `db18bca` (front) |
| 2026-11-14 | Instalación de pnpm 11 en CI (`core-js`) | commit `7d755ac` (front) |
| 2026-11-14 | API y tienda en producción en Vercel | URLs de la tabla de producción |
| 2026-11-14 | Configuración de Vercel en `main` y primer despliegue automático (backend) | https://github.com/JavierAnd0/bestcoffe-Backend/pull/2 |
| 2026-11-15 | Corregidos los hallazgos de comportamiento y rendimiento de la revisión de código; 126 unitarias + 25 de aislamiento (backend), 38 e2e (front) | este archivo |
| 2026-11-15 | Etapas 1 a 7 y los cuatro fallos de seguridad: hechos y verificados en local (backend: 115 unitarias + 24 de aislamiento; front: tipos, lint, build y 38 e2e en modo CI). Sin commitear ni desplegar | este archivo |
