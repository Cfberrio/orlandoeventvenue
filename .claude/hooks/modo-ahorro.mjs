#!/usr/bin/env node
// UserPromptSubmit hook — "modo ahorro" / "modo normal".
//
// Problema que resuelve: la regla de modo ahorro vive en CLAUDE.md y Claude
// la ignoraba (DR, 2026-09-15). CLAUDE.md se lee una vez al abrir la sesión;
// este hook corre en CADA prompt y, mientras el modo esté activo, inyecta la
// instrucción de nuevo. No depende de que Claude la recuerde.
//
// Estado: un archivo por sesión en ~/.claude/modo-ahorro/<session_id>.
// Se apaga solo al abrir otra sesión; dentro de la misma, con `modo normal`.
//
// Entrada (stdin, JSON de Claude Code): { session_id, prompt, cwd, ... }
// Salida (stdout): texto que Claude Code agrega como contexto del turno.

import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

let input = {};
try {
  input = JSON.parse(readFileSync(0, "utf8") || "{}");
} catch {
  process.exit(0);
}

const sessionId = String(input.session_id || "").replace(/[^a-zA-Z0-9_-]/g, "");
if (!sessionId) process.exit(0);

const prompt = String(input.prompt || "")
  .toLowerCase()
  .normalize("NFD")
  .replace(/[̀-ͯ]/g, "");

const stateDir = join(homedir(), ".claude", "modo-ahorro");
const stateFile = join(stateDir, sessionId);
mkdirSync(stateDir, { recursive: true });

// Limpieza: archivos de sesiones de hace más de 7 días.
try {
  const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
  for (const f of readdirSync(stateDir)) {
    const p = join(stateDir, f);
    if (statSync(p).mtimeMs < cutoff) unlinkSync(p);
  }
} catch {}

const wantsNormal = /\bmodo\s+normal\b/.test(prompt);
const wantsAhorro = /\bmodo\s+ahorro\b/.test(prompt);

let active = existsSync(stateFile);
let turn = 0;
if (active) {
  try { turn = Number(readFileSync(stateFile, "utf8")) || 0; } catch {}
}

if (wantsNormal) {
  if (active) {
    try { unlinkSync(stateFile); } catch {}
    process.stdout.write(
      "[MODO NORMAL — hook] El usuario desactivó modo ahorro. Claude vuelve a trabajar directo; " +
      "Codex queda solo para lo automático (review gate, review adversarial, trabajo mecánico). " +
      "Confirmar en una línea.\n"
    );
  }
  process.exit(0);
}

if (wantsAhorro && !active) {
  active = true;
  turn = 0;
}

if (!active) process.exit(0);

turn += 1;
writeFileSync(stateFile, String(turn));

const activation = turn === 1;

const lines = [
  `[MODO AHORRO ACTIVO — hook, turno ${turn}]`,
  "Regla obligatoria en este turno: **Codex ejecuta, Claude solo pide y verifica.** Cada token que Claude gasta leyendo o escribiendo código es un token que debía pagar la cuota de Codex.",
  "",
  "1. Todo lo delegable va al agente `codex:codex-rescue` en UN solo pedido con spec cerrado: implementar, diagnosticar, buscar en N archivos, leer logs, correr tests, comparar diffs. Pedirle que devuelva en una sola respuesta: resumen + diff + resultado de tests + evidencia con archivo:línea.",
  "2. Claude NO abre archivos ni explora el repo por su cuenta (nada de Read/Grep/Glob para investigar). Solo: entender el pedido, escribir el spec, leer las líneas exactas que Codex cite, reportar.",
  "3. Si el pedido del usuario trae trabajo delegable, delegarlo en este mismo turno, no preguntar si delegar.",
  "4. Nunca delegar: decidir qué construir, voz de marca / copy, `.env` y secretos, publicar o deploy. Eso queda con Claude o espera a `modo normal`.",
  "5. Marcar cada delegación con `→ Codex` en la respuesta para que el usuario vea a dónde fue el gasto.",
  "6. Verificar contra el código lo que Codex afirme antes de darlo por hecho (Codex observa bien y concluye mal).",
  "7. Tests: usar el comando exacto que indica el AGENTS.md / CLAUDE.md del repo, dentro del pedido a Codex.",
  "",
  "Se desactiva cuando el usuario escribe `modo normal`.",
];

if (activation) {
  lines.push(
    "",
    "Este es el turno de activación: confirmar en UNA línea que modo ahorro quedó activo y, si el usuario dijo estar por encima del 95% de la sesión, sugerir `/codex:transfer`. Si el mensaje trae además una tarea, delegarla ya."
  );
}

process.stdout.write(lines.join("\n") + "\n");
