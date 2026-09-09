---
description: Puerta pre-deploy de OEV — revisa el diff, publica y verifica contra orlandoeventvenue.org
argument-hint: "[opcional: sha o rango a revisar]"
---

Publicación de **OEV**. Proyecto Lovable `9838d610-03f9-4469-a8f3-362588d13d76`. Producción **https://orlandoeventvenue.org**.

Ejecuta en orden y **detente en el primer paso que falle**.

## 1. Revisar el diff

Determina el rango: `$ARGUMENTS` si viene, si no `origin/main...HEAD`. Si `HEAD` ya está pusheado, usa Lovable MCP `get_project` para leer `latest_commit_sha` y revisa `<latest_commit_sha>...HEAD`.

Lanza el subagente `pre-deploy-reviewer` con ese rango.

- Algún **BLOCK** → para. Reporta los hallazgos y no publiques.
- Solo **WARN** → muéstralos y pregunta si sigue.
- **PASS** → continúa.

## 2. Migraciones primero

Si el diff toca `supabase/migrations/`: aplica la migración vía Lovable MCP `query_database` **antes** de publicar el código. Confirma que corrió antes de seguir.

## 3. Push

```bash
git fetch origin main && git merge --ff-only origin/main
git push origin main
```

Si el merge no es fast-forward, es porque el bot `gpt-engineer-app[bot]` empujó a main. Resuelve y vuelve al paso 1.

## 4. Esperar el sync de Lovable

Consulta `get_project` (`9838d610-03f9-4469-a8f3-362588d13d76`) hasta que `latest_commit_sha` == tu commit. Tarda 1–7 min. **No publiques antes** — publicarías el commit anterior.

## 5. Publicar

Lovable MCP `deploy_project`.

## 6. Verificar de verdad

No confíes en el `"success"` del deploy. Haz una assertion real contra lo que tu commit cambió:

- Cambio de frontend → `curl -s https://orlandoeventvenue.org/ | grep <algo del cambio>`
- Cambio de edge function → `curl` al endpoint, o revisar sus logs.

Reporta: rango revisado, veredicto del gate, migración aplicada (sí/no), sha publicado, y el resultado del curl.
