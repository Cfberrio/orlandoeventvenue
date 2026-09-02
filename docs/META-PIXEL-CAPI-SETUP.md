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
3. Cópialo. Este es el valor #3, **temporal**.

> ⚠️ **Mientras este código esté puesto, los eventos NO cuentan como
> conversiones reales.** Sirven solo para verlos llegar en vivo. Hay que
> quitarlo cuando termines de probar. Está en el paso 5.3.

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
   | `META_TEST_EVENT_CODE` | El `TEST12345` del paso 2.1 — **temporal** |

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

### 5.3 Probar que llegan los eventos

1. Abre https://business.facebook.com/events_manager2 → tu dataset →
   pestaña **Probar eventos** / **Test Events**. Déjala abierta.
2. En otra pestaña, abre **https://orlandoeventvenue.org**
3. Deberías ver aparecer un **`PageView`** en Test Events en pocos segundos.
4. Ve a `/book`, elige un tipo de reserva → aparece **`ViewContent`**.
5. Completa el formulario hasta crear la reserva → aparece
   **`CompleteRegistration`**, y debe decir que llegó por **navegador y
   servidor** (dos fuentes, un evento).
6. Llega al checkout → **`InitiateCheckout`**.
7. Paga con una tarjeta de prueba de Stripe (o una real y la reembolsas) →
   **`Purchase`** con el monto del depósito.

**Lo que tienes que verificar en el paso 5:** que cada conversión aparezca
**una sola vez** con las dos fuentes juntas, no dos veces. Si aparece dos
veces, el `META_PIXEL_ID` del código y el del secreto no coinciden.

### 5.4 Quitar el código de prueba

Cuando todo se vea bien:

1. **Borra el secreto `META_TEST_EVENT_CODE`** en Lovable Cloud.
2. Los eventos dejan de ir a "Test Events" y empiezan a contar como
   conversiones reales.

> Si se te olvida este paso, tus campañas no van a tener ninguna conversión y
> vas a pensar que nada funciona. Es el error más común.

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
| No llega nada a Test Events | El código no se publicó (solo se hizo push) | `deploy_project` en Lovable. Ver `CLAUDE.md` |
| Llega `PageView` pero no `Purchase` | Falta `META_CAPI_TOKEN`, o expiró | Revisar secretos; mirar la tabla `meta_event_delivery`, columna `error` |
| Cada conversión aparece dos veces | `META_PIXEL_ID` del código ≠ el del secreto | Igualarlos y republicar |
| Las campañas dicen 0 conversiones | Quedó puesto `META_TEST_EVENT_CODE` | Borrar ese secreto |
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
