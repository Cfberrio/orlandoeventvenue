# Orlando Event Venue (OEV) — instrucciones para agentes de código (Codex)

Claude Code orquesta este repo. Vos sos el segundo motor, con dos trabajos y ningún otro:

1. **Review adversarial de un diff** — intentar romperlo antes de que llegue a producción.
2. **Trabajo mecánico acotado** — solo cuando el spec ya viene cerrado.

Si la tarea requiere decidir qué construir, elegir entre enfoques, o tocar voz de marca: no es tuya. Devolvela.

## Leé esto primero

`CLAUDE.md` en esta misma carpeta es el contexto real — identidad del repo, pipeline de deploy, migraciones, reglas de higiene. Este archivo no lo repite.

**Este es el repo con más superficie y menos red de seguridad de las tres marcas.** No hay CI. Tu review es el único gate automático que existe antes de producción, y lo que hay del otro lado son pagos, reservas e invoices reales.

## Stack

React 18 + Vite 5 + react-router-dom 6 + shadcn/Tailwind 3 + Supabase (Lovable Cloud) + React Query + Zod.
Gestor de paquetes: **bun**. Lockfile canónico `bun.lock`.

## Comandos

| Qué | Comando |
|---|---|
| Tests de app | `bun run test` (vitest) |
| Tests de edge functions | `bun run test:edge` (`supabase/functions/_tests/`) |
| Lint | `bun run lint` |
| Build | `bun run build` |
| Solo inglés | `bun run check:english` |

Antes de tocar pagos, balances o scheduling, corré **las dos** suites.

### Baseline conocido (verificado 2026-09-11)

| Suite | Estado |
|---|---|
| `bun run test` | **verde, 0 fallos** (156 tests al 2026-09-11) |
| `bun run test:edge` | **verde, 0 fallos** (87 tests al 2026-09-11) |

Las dos suites están limpias. Los conteos crecen; lo que no cambia es el 0. Cualquier fallo que veas lo introdujiste vos.

`bun run lint`, en cambio, arrastra ~443 errores preexistentes (casi todos `no-explicit-any`). **No corras lint sobre todo el repo esperando cero.** Lintea solo los archivos que tocaste: `bunx eslint <archivos>`.

### Quién resuelve el actor del audit trail

`useUpdateBookingDetails` (`src/hooks/useAdminData.ts:1059`) resuelve el usuario **por su cuenta** con `supabase.auth.getUser()` y lo escribe en `booking_events.metadata`. Los componentes **no** le pasan `actorId` ni `actorEmail`.

Si ves un test que espera que un componente pase el actor hacia abajo, ese test está describiendo un diseño abandonado. No agregues esos campos a la llamada para "arreglarlo".

## Prohibido, sin excepción

- **Publicar.** Un push no publica nada. El publish lo hace Claude vía Lovable MCP. Nunca corras un deploy.
- **Reescribir historia publicada.** Sin force push, sin rebase/amend/squash de commits ya empujados — rompe Lovable.
- Leer, escribir, mover o imprimir `.env` o cualquier secreto.
- Regenerar o usar como referencia `bun.lockb` y `package-lock.json`. Están trackeados pero desactualizados.
- Salir de este repo. DR y CTS son repos separados.
- Escribir copy o texto de marca.

## Trampas de este repo

- **El dominio de producción es `orlandoeventvenue.org`, no `.com`.** El `.com` es un lander parqueado. Usar `.com` en un redirect de pago ya rompió producción una vez (`9009d1c`).
- `verify_jwt` se declara por función en `supabase/config.toml`. Función nueva sin entrada ahí queda con JWT requerido por default, y los webhooks externos (GHL, Stripe) fallan **en silencio**.
- Migraciones: vos escribís el archivo en `supabase/migrations/`. **No la aplicás** — eso va por Lovable MCP y lo hace Claude.
- Si un cambio de código depende de la migración (ej. un valor nuevo en un `CHECK`), la migración va primero. Publicar el código antes deja producción escribiendo valores que la DB rechaza.

## En modo review, buscá esto

Los patrones que ya causaron incidentes reales acá:

1. Race conditions sin claim atómico (leer-chequear-escribir). Referencia del fix correcto: `d827b40`.
2. `insert`/`update` cuyo error no se verifica.
3. Webhooks o crons sin idempotencia.
4. Secretos en código.
5. Migración que cambia un `CHECK` sin el código que la acompaña.
6. Edge function sin entrada en `config.toml`.
7. Dominio `.com` en cualquier URL de pago o redirect.

Reportá por severidad, con archivo y línea. **Si no encontrás nada real, decilo.** No inventes hallazgos para justificar la corrida.

Acotá el alcance a lo que se te pidió. Este repo tiene decenas de edge functions — no audites todas de una corrida salvo que te lo pidan explícitamente.

## Definición de terminado

- `bun run test` queda en **0 fallos**. Si tocaste edge functions, `bun run test:edge` también. Las dos están verdes: no se entrega con fallos.
- `bun run lint` pasa.
- Diff mínimo y explicable.
- Sin deploy, sin secretos tocados, sin archivos nuevos que nadie pidió.
- Reportá qué cambiaste y, explícitamente, qué **no** verificaste.
