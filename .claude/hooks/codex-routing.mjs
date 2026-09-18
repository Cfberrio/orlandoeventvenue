#!/usr/bin/env node
// UserPromptSubmit hook — reparto Claude / Codex por tipo de tarea, siempre activo.
//
// Problema que resuelve (Decision Brief 2026-09-17, opción B): la tabla de
// "cuándo Claude delega a Codex" vive en CLAUDE.md y Claude la ignoraba, igual
// que ignoró la regla de modo ahorro el 2026-09-15. CLAUDE.md se lee una vez;
// este hook repite la regla en CADA prompt, corta, para que Claude clasifique
// la tarea antes de arrancar y no haga él lo mecánico.
//
// Se calla cuando modo ahorro está activo (ese hook ya inyecta la regla
// completa) y cuando el prompt es trivial (menos de 12 caracteres: "sí", "ok").
//
// Entrada (stdin, JSON de Claude Code): { session_id, prompt, cwd, ... }
// Salida (stdout): texto que Claude Code agrega como contexto del turno.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

let input = {};
try {
  input = JSON.parse(readFileSync(0, "utf8") || "{}");
} catch {
  process.exit(0);
}

const sessionId = String(input.session_id || "").replace(/[^a-zA-Z0-9_-]/g, "");
const prompt = String(input.prompt || "").trim();
if (prompt.length < 12) process.exit(0);

// Modo ahorro activo → su hook manda; no duplicar.
if (sessionId && existsSync(join(homedir(), ".claude", "modo-ahorro", sessionId))) {
  process.exit(0);
}

const rule = [
  "[REPARTO CLAUDE/CODEX — hook, siempre activo] Antes de actuar, clasifica la tarea:",
  "1. Mecánica con spec cerrado (aplicar un patrón en N archivos, backfill de tests de algo ya entendido, renames, leer logs largos, buscar en muchos archivos, comparar diffs) → delegar YA a `codex:codex-rescue` con `--model gpt-5.6-sol` y el spec completo en un solo pedido; marcar `→ Codex` en la respuesta; verificar contra el código lo que Codex afirme.",
  "2. Diff que toca código de producción del repo (ver AGENTS.md) → adversarial review de Codex antes de reportar el resultado.",
  "3. Decidir qué construir, voz de marca, `.env`/secretos, deploy, skills google-ads-*, interpretar métricas → Claude, sin delegar.",
  "Si dudas entre 1 y 3, escribe la clasificación en una línea y sigue. No hagas tú lo que cabe en 1.",
].join("\n");

process.stdout.write(rule + "\n");
