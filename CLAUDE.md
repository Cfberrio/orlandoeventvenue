# Orlando Event Venue (OEV) — reglas de trabajo (LEER SIEMPRE)

## Identidad del repo

| Dato | Valor |
|---|---|
| Marca | OEV — venue booking, lead handling, pagos, recordatorios |
| Carpeta | `~/Documents/OEV-PROJECT/`, rama `main` |
| Remote | `github.com/Cfberrio/orlandoeventvenue` |
| Frontend | Lovable, proyecto `9838d610-03f9-4469-a8f3-362588d13d76` (`orlandoeventvenue`) |
| **Producción** | **https://orlandoeventvenue.org** |
| Backend | Lovable Cloud (Supabase ref `vsvsgesgqjtwutadcshi`) |
| Superficie | 46 edge functions + 134 migraciones |

**`orlandoeventvenue.com` NO es la app** — es un lander parqueado (redirige a `/lander`). Si vas a verificar un deploy, verifica contra `orlandoeventvenue.org`. `orlandoeventvenue.lovable.app` es el mismo build publicado.

## Deploy: un push NO publica nada

`git push origin main` **no cambia orlandoeventvenue.org**. El pipeline completo es:

1. Commit en `main` → `git push origin main`.
   - Antes de push: `git fetch` + merge — Lovable (bot `gpt-engineer-app[bot]`) también empuja commits a main.
2. Lovable auto-sincroniza desde GitHub (1–7 min). Verificar con Lovable MCP:
   `get_project` (project `9838d610-03f9-4469-a8f3-362588d13d76`) hasta que `latest_commit_sha` == tu commit. **NO publicar antes** — publicarías el commit anterior.
3. Publicar: Lovable MCP `deploy_project`.
4. Verificar con assertion real: `curl` al HTML/asset/endpoint que tu commit cambia. No confiar en el `"success"` del deploy.

**Si un cambio "no sale" en la web: casi siempre falta el paso 3 (Publish).**

## Puerta pre-deploy (obligatoria)

Antes de cada publish, correr `/pre-deploy`. Revisa **el diff**, no el repo entero. Cuesta un agente por deploy.

Motivo: OEV publica 46 edge functions sin revisión previa y con menos tests que DR. En agosto 2026 se descubrió por accidente que `ghl-sms-draft` corría una race condition — drafts AI duplicados llegando al cliente — que DR ya tenía arreglada hacía meses (arreglado aquí en `d827b40`). Nadie tenía forma de saberlo. El patrón era leer-chequear-escribir sin verificar el error del insert: detectable en segundos por un reviewer.

El gate falla si el diff tiene: race conditions sin claim atómico, `insert`/`update` cuyo error no se verifica, webhooks o crons sin idempotencia, secretos en código, o una migración que cambia un CHECK sin el código que la acompaña.

## Codex — segundo motor, automático

Codex está integrado como revisor adversarial y ejecutor de trabajo mecánico. `AGENTS.md` (misma carpeta) define qué puede hacer Codex; esta sección define **cuándo Claude lo llama sin que nadie se lo pida**.

Este es el repo con más superficie y menos red de seguridad de las tres marcas. Codex es el CI que no existe: úsalo.

### Siempre encendido: review gate

El stop-review-gate del plugin está activo en este repo. Cada turno de Claude que modifique código pasa por Codex antes de poder cerrarse. Si Codex devuelve `BLOCK`, se arregla antes de terminar el turno — no se reporta como listo con un BLOCK pendiente. Los turnos sin cambios de código devuelven `ALLOW`, pero no gratis: cada corrida del gate cuesta ~20K tokens de Codex (lee el contexto para decidir que no hay nada). Ese costo va a la cuota de ChatGPT, nunca a la de Claude; un `ALLOW` no devuelve nada a Claude.

Es configuración local de esta máquina, no viaja por git. Si en otra máquina `/codex:setup` dice `reviewGateEnabled: false`, activarlo con `/codex:setup --enable-review-gate`.

### Claude delega a Codex por su cuenta cuando:

| Situación | Qué hacer |
|---|---|
| **Va a publicar** (`deploy_project`) | Además de `/pre-deploy`, correr un review adversarial de Codex sobre todo el diff desde el último publish. Los dos gates son obligatorios; ninguno reemplaza al otro. |
| **El diff toca superficie crítica**: `supabase/functions/**`, `supabase/migrations/**`, o paths con `stripe`, `checkout`, `payment`, `balance`, `invoice`, `payroll`, `webhook`, `cron`, `scheduled` | Review adversarial al terminar la implementación, **antes** de reportar el resultado. |
| **La tarea es mecánica con spec cerrado**: aplicar un patrón ya conocido en N funciones, backfill de tests sobre una función ya entendida, barridos de renombrado o i18n | Delegar la ejecución a Codex con el spec exacto. Claude verifica el resultado y corre `bun run test` + `bun run test:edge`. |
| **Dos intentos sin resolver un bug** | Pedir a Codex un diagnóstico independiente antes de un tercer intento. |

### Nunca delegar

- Decidir qué construir, ni elegir entre enfoques.
- Copy o textos de cara al cliente.
- Trabajo que cruce a DR o CTS.
- Nada que toque `.env` o secretos.
- Publicar. Codex nunca deploya.

### Cómo invocarlo

El plugin vive en `~/.claude/plugins/cache/openai-codex/codex/<versión>/`. Resolver la versión con `ls -d ~/.claude/plugins/cache/openai-codex/codex/*/ | tail -1`.

- **Review adversarial** (read-only): `node "<plugin>/scripts/codex-companion.mjs" adversarial-review --wait`. Para diffs grandes usar `--background` y seguir con `/codex:status`.
- **Delegar trabajo** (write): agente `codex:codex-rescue` con el spec cerrado en el prompt.

### Modo ahorro (lo activa el usuario)

Claude no puede ver el % de límite de sesión; el usuario sí (`/usage`). Cuando el usuario escribe **`modo ahorro`**, Claude cambia de "hacer" a "reenviar y verificar" hasta que escriba **`modo normal`**. Objetivo: que el gasto de Claude caiga al costo de escribir el pedido y leer el resultado; el trabajo pesado (leer archivos, razonar, escribir código, correr tests) lo paga la cuota de Codex.

Mientras está activo:

- **Todo lo delegable va a `codex:codex-rescue`** en un solo pedido con spec cerrado: implementar, diagnosticar, correr `bun run test` + `bun run test:edge`, leer logs, buscar en N archivos, comparar diffs. Claude no explora el repo por su cuenta; pide a Codex que reporte evidencia con archivo y línea.
- **Claude conserva solo lo que no se delega**: entender el pedido, escribir el spec, verificar el resultado de forma puntual (leer las líneas que Codex cita, no el archivo entero), reportar. La lista "Nunca delegar" sigue vigente — copy, decidir qué construir, `.env`, publicar quedan con Claude o esperan a `modo normal`.
- **Un pedido a Codex por tarea**, no uno por paso. Pedir que Codex devuelva resumen + diff + resultado de tests en una sola respuesta; cada ida y vuelta extra cuesta tokens de Claude.
- Claude marca cada delegación con `→ Codex` en la respuesta, para que el usuario vea a dónde fue el gasto.
- Al activar, Claude confirma en una línea y sugiere `/codex:transfer` si el usuario está por encima del 95%: desde ahí el chat de Claude ya no sirve, y la conversación sigue en Codex con contexto.

**Regla de oro:** verificar contra el código lo que Codex afirme antes de actuar. Codex observa bien y concluye mal con frecuencia — aquí mismo reportó un "bug de producción" en el audit trail de `BookingEditDialog` que no existía; `useUpdateBookingDetails` resolvía el actor por su cuenta. La segunda opinión vale por el ciclo de verificación, no por la opinión en sí.

## Agentes especialistas

Viven en `.claude/agents/`. Vienen de `msitarzewski/agency-agents` (258 definiciones), reescritos con los datos reales de este repo. **No se instaló el catálogo** — se tomaron las definiciones que tapan un agujero concreto.

| Agente | Cuándo |
|---|---|
| `pre-deploy-reviewer` (`/pre-deploy`) | Antes de publicar. Revisa el diff. BLOCK/WARN/PASS |
| `release-verifier` | **Después** de publicar. Verifica contra `.org` con evidencia real. Por defecto NO CERTIFICA |
| `lovable-code-auditor` | Auditoría de seguridad de código generado por Lovable: secretos, RLS, `verify_jwt = false` sin validación propia, service-role, prompt injection, dominio de pago |
| `payments-auditor` | Antes de tocar checkout, balances, invoices, descuentos, payroll o `stripe-webhook` |

OEV es el repo con más superficie (46 funciones, 134 migraciones) y menos red de seguridad. Los cuatro están calibrados para eso: alcance acotado por corrida, no auditorías de 46 funciones de una vez.

Para comparar una función con sus hermanas de DR y CTS: `cross-brand-function-auditor`, en el repo `~/Documents/CLAUDE CODE`. Para gasto de créditos Lovable (los `daily-health-check` / `verify-system-health` / `process-*` corren solos): `lovable-cost-auditor`, mismo repo.

## Migraciones

- Archivo en `supabase/migrations/` **y** aplicar vía Lovable MCP `query_database`.
- Si un cambio de código depende de la migración (ej. un valor nuevo en un CHECK), **la migración va primero**. Publicar el código antes deja producción escribiendo valores que la DB rechaza.
- Fallback CLI: `supabase link --project-ref vsvsgesgqjtwutadcshi` + `supabase db push`.

## Edge functions

- Viajan con el sync de Lovable. Después de publicar, verificar con `curl` real al endpoint o revisando logs — no asumir que subió.
- `verify_jwt` se declara por función en `supabase/config.toml`. Función nueva sin entrada ahí = JWT requerido por default; los webhooks externos (GHL, Stripe) fallarán en silencio.
- Tests de edge: `bun run test:edge` (`supabase/functions/_tests/`). Correrlos antes de tocar pagos, balances o scheduling.

## Reglas de higiene

- Lockfile canónico = `bun.lock`. El repo también trackea `bun.lockb` y `package-lock.json` **desactualizados** — no los uses como referencia y no los regeneres; pendiente borrarlos.
- `.env` está gitignored y vive aquí. No borrar.
- Dominio en redirects de pago: usar el que sirve la app (`orlandoeventvenue.org`), no `.com`. Ya rompió una vez (`9009d1c`).

## Marcas vecinas

DR (`~/Documents/DISCIPLINERIFT/disciplinerift`) y CTS (`~/Documents/CheeseToShare`) corren edge functions con el mismo linaje: `ghl-sms-draft`, `stripe-webhook`, `composio-gmail-webhook`, `create-checkout-session`, `process-scheduled-jobs`. **Un bug arreglado aquí probablemente vive allá.** Cuando arregles algo en una función compartida, revisa las hermanas antes de cerrar la tarea.

Contenido, copy y estrategia de OEV no se mezclan con DR ni CTS. Este repo es lógica de booking y conversión, no voz de marca.

## Sistema operativo personal (Cris 2026)
Regla de comunicación, cierre de tasks, análisis previo y evidencia para el plan de 90 días de Cristian. Se carga en todos los repos.
@.claude/rules/05-cris-2026.md
