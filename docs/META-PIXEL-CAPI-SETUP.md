# Cómo encender el Meta Pixel + Conversions API en OEV

Guía paso a paso, asumiendo cero conocimiento previo de Meta Business.

**Estado actual del código:** todo está instalado y funcionando, pero
**apagado hacia Meta**. Ahora mismo OEV guarda toda la data en su propia base
(visitantes, UTMs, embudo, conversiones) y no envía nada a Facebook. Encenderlo
son 4 valores: uno en el código y tres secretos en el servidor.

Nada de esto rompe nada si sale mal. Sin los valores, el sistema sigue
guardando todo internamente y solo marca los envíos como `skipped_no_secrets`.

> **Aviso sobre la UI de Meta:** Meta cambia los nombres de sus botones y
> menús cada pocos meses. Los nombres exactos abajo pueden variar; lo que no
> cambia es la secuencia y qué estás buscando en cada paso. Si un botón se
> llama distinto, busca el que haga lo mismo.

---

## Qué son estas dos cosas (en una frase cada una)

- **Pixel** = un script en el navegador del visitante. Ve lo que la persona
  hace en el sitio y se lo cuenta a Meta. Se lo bloquean los ad blockers, iOS
  y Safari — hoy pierde entre 20% y 40% de los eventos.
- **Conversions API (CAPI)** = tu servidor le cuenta a Meta lo mismo,
  directamente. Nadie lo puede bloquear.

Se usan **los dos a la vez**. Cada conversión se manda dos veces con el mismo
identificador (`event_id`), y Meta las junta en una sola. Si el navegador se
pierde, queda la del servidor. Eso ya está resuelto en el código.

---

## PARTE 1 — Crear el Dataset (el Pixel) en Meta

### 1.1 Entrar a Business Manager

1. Abre https://business.facebook.com
2. Inicia sesión con la cuenta de Facebook que administra la página de
   Orlando Event Venue.
3. Arriba a la izquierda hay un selector de negocio. Asegúrate de estar en el
   negocio de **Orlando Event Venue**, no en uno personal ni en otro cliente.

**Si no existe un Business Manager para OEV:** créalo en
https://business.facebook.com/overview → "Crear cuenta". Necesitas el nombre
legal del negocio, tu nombre y un email de trabajo. Después vincula la página
de Facebook y la cuenta publicitaria de OEV desde
**Configuración del negocio → Cuentas**.

### 1.2 Ir a Events Manager

1. Menú de la izquierda (o el menú de cuadraditos arriba a la izquierda) →
   **Administrador de eventos** / **Events Manager**.
   URL directa: https://business.facebook.com/events_manager2
2. Vas a ver una lista de "orígenes de datos" / "data sources". Si OEV nunca
   tuvo pixel, estará vacía.

### 1.3 Crear el Dataset

1. Botón verde **Conectar orígenes de datos** / **Connect data sources**.
2. Elige **Web**.
3. Ponle nombre: **`Orlando Event Venue Website`**.
   > Usa un nombre que se entienda dentro de un año. No "Pixel 1".
4. Meta te va a ofrecer métodos de instalación (Partner Integration, Manual,
   Conversions API Gateway…). **Elige "Instalar el código manualmente"** o
   simplemente **cierra el asistente**. No necesitas que Meta te dé el código:
   ya está escrito en el repo.

### 1.4 Copiar el Dataset ID

1. En Events Manager, selecciona el dataset que acabas de crear.
2. Arriba, debajo del nombre, aparece el ID: un número de **15 o 16 dígitos**,
   algo como `1053126587366635`.
3. **Cópialo.** Este es el valor #1 de los 4.

---

## PARTE 2 — Generar el token de la Conversions API

Este token es una contraseña. Quien lo tenga puede escribir eventos en tu
cuenta publicitaria. **Nunca va en el código del sitio web** — solo como
secreto del servidor.

1. Sigue dentro del dataset, en Events Manager.
2. Pestaña **Configuración** / **Settings**.
3. Baja hasta la sección **Conversions API**.
4. Busca **Generar token de acceso** / **Generate access token**.
   > A veces está escondido detrás de "Configurar directamente con el código
   > de la API" / "Set up directly using the API" → ahí sale el enlace.
5. Meta genera una cadena muy larga (200+ caracteres, empieza por `EAA...`).
6. **Cópiala ahora mismo.** Meta no te la vuelve a mostrar. Si la pierdes,
   generas otra y la vieja se puede revocar.

Este es el valor #2.

### 2.1 (Opcional, solo para probar) el código de prueba

1. Misma pantalla del dataset → pestaña **Probar eventos** / **Test Events**.
2. Aparece un código tipo `TEST12345`.
3. Cópialo. Este es el valor #3.

> Desde 2026-09-28 este código **ya no es un interruptor global**. Solo marca
> como prueba los eventos de la pestaña que abras con
> `?oev_test_event_code=TEST12345`. El resto del tráfico sigue contando como
> conversión real aunque el secreto esté puesto. Ver 5.3.

---

## PARTE 3 — Poner el ID en el código

1. Abre el archivo `src/lib/tracking/config.ts`
2. Busca esta línea:

   ```ts
   export const META_PIXEL_ID = "";
   ```

3. Pega el Dataset ID entre las comillas:

   ```ts
   export const META_PIXEL_ID = "1053126587366635";
   ```

   (con TU número, no ese)

4. Guarda. Commit y push a `main`.

**Eso es lo único que cambia en el código.** El token NO va aquí — el archivo
`config.ts` viaja al navegador de cada visitante y cualquiera lo puede leer.

---

## PARTE 4 — Poner los secretos en el servidor

Los secretos viven en Lovable Cloud (Supabase), no en el repo.

1. Abre el proyecto en Lovable: https://lovable.dev/projects/9838d610-03f9-4469-a8f3-362588d13d76
2. Ve a la sección de backend / Supabase → **Edge Functions → Secrets**
   (en Supabase directo: **Project Settings → Edge Functions → Secrets**).
3. Añade estos secretos:

   | Nombre | Valor |
   |---|---|
   | `META_PIXEL_ID` | El **mismo** número del paso 1.4 |
   | `META_CAPI_TOKEN` | El token largo del paso 2 |
   | `META_TEST_EVENT_CODE` | El `TEST12345` del paso 2.1 — lista blanca para sesiones de prueba (vacío = modo prueba apagado) |

> ❗ `META_PIXEL_ID` tiene que ser **idéntico** al del código. Si son distintos,
> el navegador reporta a un dataset y el servidor a otro, y Meta cuenta cada
> conversión dos veces en lugar de juntarlas.

---

## PARTE 5 — Aplicar migraciones, publicar y probar

### 5.1 Aplicar las migraciones a la base

Las dos migraciones nuevas crean las tablas y las vistas:

```
supabase/migrations/20260902140000_meta_tracking.sql
supabase/migrations/20260902140100_meta_attribution_reporting.sql
```

Se aplican vía Lovable MCP `query_database` (ver `CLAUDE.md` → Migraciones).
**Van primero, antes de publicar el código**, porque las edge functions
escriben en esas tablas desde el primer request.

### 5.2 Publicar

Recuerda (`CLAUDE.md`): **un push NO publica nada**.

1. `git push origin main`
2. Esperar a que Lovable sincronice (1–7 min). Verificar con MCP `get_project`
   que `latest_commit_sha` sea tu commit.
3. Publicar con MCP `deploy_project`.
4. Verificar con `curl` contra **orlandoeventvenue.org** (no `.com`).

### 5.3 Probar que llegan los eventos (Test Events)

Hay dos mitades y cada una llega a Test Events por un camino distinto:

- **Navegador (Pixel):** Meta liga sola la pestaña que abres desde Test Events.
  No necesita código. **Se rompe si el navegador bloquea `connect.facebook.net`**
  (bloqueador de anuncios, Brave, DNS filtrado). Prueba en una ventana de
  invitado de Chrome, sin extensiones.
- **Servidor (CAPI):** necesita el `test_event_code`. Solo se aplica a la
  pestaña que lo pidió.

Pasos:

1. Events Manager → dataset **Orlando Event Website** → **Test Events** →
   copia el código (`TEST12345`).
2. Lovable Cloud → Edge Functions → Secrets: pon `META_TEST_EVENT_CODE` =
   ese código. (Si ya está igual, no toques nada.)
3. Ventana de invitado de Chrome, sin extensiones, con Events Manager abierto
   en esa misma ventana. En **Test Events → Website**, pega como URL:
   `https://orlandoeventvenue.org/?oev_test_event_code=TEST12345`
   y pulsa **Open website**. **Siempre desde ahí, nunca pegando la URL directo
   en otra pestaña:** el parámetro solo marca como prueba la mitad del
   servidor; la mitad del navegador queda marcada como prueba únicamente
   cuando Meta abre la pestaña. Abierta a mano, el `InitiateCheckout` /
   `Purchase` del navegador entra como conversión real.
4. DevTools → Network → filtro `facebook`. Debe haber `fbevents.js` 200 y
   `tr/?id=27500552799622072&ev=PageView` 200. Si no aparecen, el Pixel está
   bloqueado en ese navegador: Test Events nunca los va a ver.
5. `/book` → elige tipo → **`ViewContent`** (solo navegador).
6. **Usa un email Y una fecha que nunca hayas usado.** Si repites email + fecha
   de una reserva pendiente, el sistema reutiliza esa reserva y sus event_id
   ya se gastaron: el servidor no reenvía `CompleteRegistration` ni
   `InitiateCheckout` (correcto en producción, confuso en una prueba).
   Truco: `tuemail+test0928@gmail.com`.
7. Completa hasta pagar → **`CompleteRegistration`** y **`InitiateCheckout`**
   (navegador + servidor, mismo event_id `evt_booking_<id>` / `evt_checkout_<id>`).
8. **Purchase:** Stripe está en modo live. No hay tarjeta de prueba. Un
   Purchase de prueba = un cobro real (depósito de la reserva) + reembolso.
   Solo con aprobación explícita. Si pagas, el webhook manda el Purchase del
   servidor con el código de prueba aunque cierres la pestaña, porque el código
   viaja en la metadata de la sesión de Stripe.
9. Verifica en la base:

   ```sql
   select created_at, event_name, meta_event_id, status, test_event_code, error
   from meta_event_delivery order by created_at desc limit 10;
   ```

   Las filas de tu prueba tienen `test_event_code` = tu código. Las reales, `null`.

**Lo que tienes que verificar:** cada conversión aparece **una sola vez** con las
dos fuentes juntas. Si aparece dos veces, el `META_PIXEL_ID` del código y el del
secreto no coinciden.

### 5.4 Terminar la prueba

1. Abre `https://orlandoeventvenue.org/?oev_test_event_code=off`, o cierra la
   pestaña (el código vive en `sessionStorage`, muere con la pestaña).
2. Opcional: borra `META_TEST_EVENT_CODE` en Lovable Cloud. Con el secreto vacío
   el modo prueba queda apagado para todos. Dejarlo puesto **no** afecta al
   tráfico normal.
3. Las reservas de prueba siguen siendo reservas reales en la base: cancélalas
   desde el admin.

---

## PARTE 6 — Etiquetar los anuncios (si no, no sabes qué anuncio vendió)

El Pixel dice *que* hubo una reserva. Los UTMs dicen **qué anuncio** la trajo.
Sin ellos, el panel de atribución va a mostrar todo como "(direct/organic)".

En Ads Manager, en cada anuncio, campo **Parámetros de URL** / **URL
parameters** (está abajo, en la sección de Seguimiento / Tracking):

```
utm_source=facebook&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_content={{ad.name}}&utm_term={{adset.name}}&meta_campaign_id={{campaign.id}}&meta_adset_id={{adset.id}}&meta_ad_id={{ad.id}}&meta_placement={{placement}}
```

Cópialo tal cual. Las llaves dobles `{{...}}` son variables de Meta: se
rellenan solas con el nombre y el id reales de cada anuncio.

**Por qué van los ids además de los nombres:** si un día renombras un anuncio,
el nombre cambia pero el id no. El reporte agrupa por id y etiqueta con el
nombre, así que renombrar no te parte el histórico.

---

## PARTE 7 — Ver los resultados

**Panel en la app:** `/admin/analytics` → pestaña **Ad Attribution**.
(Necesitas estar logueado con un usuario que tenga rol `admin`.)

Ahí ves:
- Reservas y facturación atribuidas a anuncios
- Desglose por canal, por creativo y por ad set / GEO
- El embudo completo desde `/book` hasta depósito pagado
- El log de envíos a Meta — si algo falló, sale ahí

**Lo que el panel NO calcula: ROAS.** Esta base sabe cuánto entró; solo Ads
Manager sabe cuánto gastaste. Divide tú: revenue del panel ÷ gasto de Ads
Manager.

---

## Problemas comunes

| Síntoma | Causa casi segura | Qué hacer |
|---|---|---|
| No llega nada a Test Events | Pixel bloqueado en tu navegador (bloqueador, Brave, DNS) o el código no se publicó | Ventana de invitado sin extensiones; DevTools → Network → `facebook`. Si falta publicar: `deploy_project` |
| Llegan eventos de navegador pero no de servidor | La pestaña no se abrió con `?oev_test_event_code=`, o el secreto no coincide | Parte 5.3, pasos 2–3 |
| En la prueba no sale `InitiateCheckout` del servidor | Repetiste email + fecha de una reserva pendiente | Email y fecha nuevos |
| Llega `PageView` pero no `Purchase` | Falta `META_CAPI_TOKEN`, o expiró | Revisar secretos; mirar la tabla `meta_event_delivery`, columna `error` |
| Cada conversión aparece dos veces | `META_PIXEL_ID` del código ≠ el del secreto | Igualarlos y republicar |
| Las campañas dicen 0 conversiones | Antes de 2026-09-28: `META_TEST_EVENT_CODE` global. Hoy ya no aplica | Mirar `meta_event_delivery.test_event_code`: en tráfico real debe ser `null` |
| Todo sale como "(direct/organic)" | Los anuncios no llevan UTMs | Parte 6 |
| El panel dice "relation does not exist" | Las migraciones no se aplicaron | Parte 5.1 |
| `skipped_no_secrets` en el panel | Faltan los secretos del servidor | Parte 4 |

### Dónde mirar cuando algo no cuadra

```sql
-- Últimos envíos a Meta y por qué fallaron
select created_at, event_name, status, error
from meta_event_delivery
order by created_at desc
limit 20;

-- Salud por día
select * from v_meta_delivery_health order by day desc limit 20;

-- ¿Se está capturando atribución?
select first_utm, last_utm, booking_id, email, last_seen_at
from tracking_visitor
order by last_seen_at desc
limit 20;
```

---

## Sobre el banner de cookies

El banner que ve el visitante tiene "Accept all" y "Essential only". **Hoy la
captura de datos sigue igual elija lo que elija** — es una decisión de producto
tomada el 2026-09-02, y el banner lo dice explícitamente en su propio texto.

Si algún día hace falta que "Essential only" realmente apague el Pixel (tráfico
de Europa o de California, o un cliente que pida una declaración de
cumplimiento), es **una sola línea**:

```ts
// src/lib/tracking/consent.ts
export const HONOR_AD_OPT_OUT = true;   // era false
```

Nada más cambia. El resto del código ya lo respeta.

---

## Referencia técnica

Cómo funciona por dentro, qué evento se dispara dónde, cómo se garantiza que
nada se cuenta dos veces, y qué datos llegan y no llegan a Meta:
**`docs/meta-tracking.md`**.
