# MercadoPago: configuración y pruebas

Cada tienda cobra en **su propia cuenta** de MercadoPago (modelo marketplace).
La plataforma tiene **una sola aplicación** en MercadoPago Developers; cada tienda
la autoriza por OAuth desde el panel, y la plataforma cobra su comisión en cada
pago (`application_fee`).

## Cómo funciona

1. **Conexión (dueño de la tienda).** En Panel → Configuración pulsa *Conectar
   MercadoPago*, autoriza en MercadoPago y vuelve a `/admin/configuracion?mp=connected`.
   El backend guarda los tokens cifrados y deja `paymentProvider = MERCADOPAGO`.
2. **Pago (comprador) con Checkout Pro.** En el paso *Método de pago* el
   comprador ve la opción MercadoPago y pulsa *Pagar $… con MercadoPago*.
   `POST /v1/orders` crea el pedido (pendiente) y una **preferencia** en la
   cuenta de la tienda, con la comisión de la plataforma (`marketplace_fee`).
   El comprador va a la página de MercadoPago y paga con lo que tenga: tarjetas
   guardadas (si tiene sesión), tarjeta nueva, PSE, Nequi, Efecty o saldo. Si un
   intento se rechaza, puede probar otro medio ahí mismo; el pedido sigue pendiente.
3. **Regreso.** MercadoPago devuelve a `/checkout/confirmacion?orderId=…&pago=aprobado|pendiente|fallido&payment_id=…`.
   La confirmación llama a `POST /v1/mercadopago/sync` (servidor a servidor, con
   el secreto interno), que consulta el pago con el token de la tienda y lo
   aplica al pedido sin esperar el webhook. Solo aplica pagos de esa tienda cuyo
   `external_reference` sea ese pedido.
   - Aprobado → "¡Gracias por tu compra!" (inventario, cupón y correo).
   - Pendiente (Efecty, PSE en curso) → "Estamos confirmando tu pago".
   - Fallido → "El pago no se completó"; el carrito sigue guardado.
4. **Webhook.** `POST /v1/mercadopago/webhook` valida la firma y hace lo mismo
   que el regreso, para los pagos que se acreditan después (Efecty, PSE) o si el
   comprador cierra la pestaña. Encuentra el pedido por el `user_id` del vendedor
   y el `external_reference`. Un pedido pagado solo puede pasar a reembolsado.

Comisión: tiendas en modalidad COMISIÓN pagan su `commissionPct`; las demás,
`MP_MARKETPLACE_FEE_PCT` (0 = sin comisión).

## Lo que hay que hacer una vez (plataforma)

1. Entra a <https://www.mercadopago.com.co/developers/panel/app> con la cuenta
   de la plataforma y crea una aplicación:
   - Tipo de solución: **pagos online**, integración **Checkout Pro**.
   - Modelo: **marketplace** (para cobrar en nombre de las tiendas).
2. En *Credenciales de producción* copia **Client ID** y **Client secret**.
3. En *Configuración avanzada → URLs de redireccionamiento* agrega
   `https://<API>/v1/mercadopago/oauth/callback`.
   MercadoPago exige HTTPS: para probar en local usa un túnel
   (`cloudflared tunnel --url http://localhost:3001` o ngrok).
4. En *Webhooks* configura `https://<API>/v1/mercadopago/webhook` con el evento
   **Pagos**, y copia la **clave secreta** que genera.
5. Variables en Vercel (backend):

   | Variable | Valor |
   | --- | --- |
   | `MP_CLIENT_ID` | Client ID |
   | `MP_CLIENT_SECRET` | Client secret |
   | `MP_REDIRECT_URI` | `https://<API>/v1/mercadopago/oauth/callback` (idéntica a la del paso 3) |
   | `MP_WEBHOOK_SECRET` | Clave secreta del webhook |
   | `MP_MARKETPLACE_FEE_PCT` | % de comisión por defecto (opcional) |
   | `TOKEN_ENCRYPTION_KEY` | `openssl rand -base64 32`. **No la cambies después**: los tokens guardados quedarían ilegibles y cada tienda tendría que reconectar |
   | `WEB_APP_URL` | URL pública del front (regreso tras OAuth y PSE) |

## Probar en sandbox

1. En la aplicación, *Cuentas de prueba* → crea **dos** usuarios de prueba de
   Colombia: uno **vendedor** y uno **comprador**.
2. Con el backend apuntando a la aplicación, entra al panel de una tienda PRO o
   BUSINESS y conecta MercadoPago **iniciando sesión con el vendedor de prueba**.
3. En la tienda, compra y en MercadoPago entra con el **comprador de prueba**.
   Paga con las tarjetas de prueba de Colombia:
   <https://www.mercadopago.com.co/developers/es/docs/checkout-pro/integration-test/test-cards>.
   El **nombre del titular** decide el resultado:
   - `APRO` → aprobado: vuelves a "¡Gracias por tu compra!" y llega el correo.
   - `OTHE` → rechazado: MercadoPago te deja intentar con otro medio.
   - `CONT` → pendiente: "Estamos confirmando tu pago".
4. Sin URL HTTPS de regreso (en local) MercadoPago no vuelve solo: usa el botón
   *Volver al sitio* de MercadoPago, o el túnel HTTPS del paso 3 de arriba.
5. Revisa en el panel que el pedido cambie de estado al llegar el webhook (los
   logs del backend muestran `Webhook MP` si algo no cuadra).

## Pendiente

- Reintentar el pago de un pedido pendiente desde *Mis pedidos* (hoy, al volver
  sin pagar, el comprador repite el checkout y se crea un pedido nuevo; el
  anterior queda pendiente).
- Cobro automático de **renovaciones** de suscripción con MercadoPago: hoy cada
  renovación genera un pedido pendiente que el cliente paga como cualquier otro.
- Reembolsos desde el panel (hoy se hacen en MercadoPago; el webhook marca el
  pedido como reembolsado).
