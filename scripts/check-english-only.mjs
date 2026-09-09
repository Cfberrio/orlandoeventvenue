#!/usr/bin/env node
/**
 * English-only guard.
 *
 * Every string that reaches a screen, an email, an SMS or a notification must be
 * in English. This walks the shipping source and fails on Spanish UI vocabulary
 * and on Spanish-only punctuation.
 *
 * Run: `node scripts/check-english-only.mjs` (also wired into `bun run test`
 * through src/test/english-only.test.ts).
 *
 * A file that legitimately contains Spanish — a parser for Spanish input, a
 * fixture with a Spanish personal name — goes in ALLOWLIST with a reason.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

// Both entry points (the CLI and the vitest suite) run from the repo root.
const DEFAULT_ROOT = process.cwd();

const SCAN_DIRS = ["src", "supabase/functions"];
const EXTS = new Set([".ts", ".tsx", ".js", ".jsx"]);
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage", ".git", ".claude-flow"]);

/** path prefix (posix) -> why Spanish is allowed there */
const ALLOWLIST = {
  "supabase/functions/_shared/email-body.ts":
    "matches the Spanish quoted-reply header of inbound email; it parses Spanish, it never renders it",
  "supabase/functions/ghl-sms-draft/index.ts":
    "matches the Spanish quoted-reply header of inbound messages; it parses Spanish, it never renders it",
};

const WORDS = [
  "editar", "edición", "guardar", "guardado", "cancelar", "eliminar", "borrar", "buscar",
  "cerrar", "abrir", "agregar", "añadir", "nuevo", "nueva", "nuevos", "nuevas",
  "fecha", "fechas", "hora", "horas", "horario", "horarios", "nombre", "apellido",
  "correo", "teléfono", "telefono", "dirección", "direccion",
  "reserva", "reservas", "reservación", "reservacion", "usuario", "usuarios",
  "contraseña", "sesión", "sesion", "cargando", "cargar", "enviar", "enviado",
  "actualizar", "actualizado", "seleccionar", "selecciona", "seleccione",
  "volver", "siguiente", "anterior", "aceptar", "confirmar", "confirmación", "confirmacion",
  "pagar", "pago", "pagos", "pagado", "precio", "precios", "descuento", "descuentos",
  "empleado", "empleados", "inventario", "limpieza", "reporte", "reportes",
  "factura", "facturas", "nómina", "nomina", "configuración", "configuracion",
  "detalle", "detalles", "pendiente", "completado", "cancelado", "cancelada",
  "éxito", "exitoso", "requerido", "obligatorio", "mensaje", "mensajes",
  "disponible", "disponibles", "disponibilidad", "duración", "duracion",
  "cantidad", "cliente", "clientes", "evento", "eventos", "espacio", "espacios",
  "salón", "salon", "gracias", "bienvenido", "bienvenida", "hola",
  "asignar", "asignado", "asignación", "asignacion", "turno", "turnos",
  "programar", "programado", "recordatorio", "recordatorios",
  "invitado", "invitados", "puerta", "llave", "luces", "basura", "silla", "sillas",
  "mesa", "mesas", "baño", "baños", "cocina", "inodoro", "inodoros",
  "intenta", "intentar", "nuestro", "nuestra", "nuestros", "nuestras",
  "ubicación", "ubicacion", "verificación", "verificacion",
  "escuela", "escuelas", "equipo", "equipos", "entrenador", "entrenadores",
  "padres", "hijo", "hija", "temporada", "temporadas", "práctica", "practica",
  "asistencia", "estudiante", "estudiantes", "jugador", "jugadores",
  "inscripción", "inscripcion", "inscribirse", "coincidan", "encontramos", "encontraron",
  "debe", "puede", "tiene", "faltan", "vacío", "vacio",
  // Weekday and month names — the classic leak from an unpinned locale.
  "lunes", "martes", "miércoles", "miercoles", "jueves", "viernes", "sábado", "sabado", "domingo",
  "enero", "febrero", "marzo", "abril", "junio", "julio", "agosto",
  "septiembre", "octubre", "noviembre", "diciembre",
];

/**
 * Words distinctive enough that a single one is already a failure — the leaks
 * that started this sweep were lone button labels ("Guardar", "Cancelar").
 */
const SOLO_WORDS = [
  "editar", "guardar", "cancelar", "eliminar", "borrar", "cargando", "contraseña",
  "reservación", "reservacion", "seleccionar", "actualizar", "confirmar",
  "bienvenido", "bienvenida", "gracias", "inscripción", "inscripcion",
  "asignación", "asignacion", "ubicación", "ubicacion", "verificación", "verificacion",
  "configuración", "configuracion", "duración", "duracion", "disponibilidad",
  "recordatorio", "recordatorios", "entrenador", "entrenadores", "estudiantes",
];

const WORD_RE = new RegExp(`(?<!\\p{L})(${WORDS.join("|")})(?!\\p{L})`, "giu");
const SOLO_RE = new RegExp(`(?<!\\p{L})(${SOLO_WORDS.join("|")})(?!\\p{L})`, "giu");
// ñ and inverted punctuation exist in no English word.
const ORTHO_RE = /[ñÑ¿¡]/u;

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry) || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (EXTS.has(entry.slice(entry.lastIndexOf(".")))) out.push(full);
  }
  return out;
}

function isAllowed(rel) {
  return Object.keys(ALLOWLIST).some((prefix) => rel === prefix || rel.startsWith(`${prefix}/`));
}

/** @returns {{file: string, line: number, hits: string[], text: string}[]} */
export function findSpanish(root = DEFAULT_ROOT) {
  const findings = [];
  for (const dir of SCAN_DIRS) {
    for (const file of walk(join(root, dir))) {
      const rel = relative(root, file).split(sep).join("/");
      if (isAllowed(rel)) continue;
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        const words = [...line.matchAll(WORD_RE)].map((m) => m[1].toLowerCase());
        const solo = [...line.matchAll(SOLO_RE)].map((m) => m[1].toLowerCase());
        const ortho = ORTHO_RE.test(line);
        // One stray word can be a coincidence; two of them, one unmistakable
        // word, or any ñ/¿/¡ is Spanish.
        if (words.length >= 2 || solo.length > 0 || ortho) {
          findings.push({
            file: rel,
            line: i + 1,
            hits: [...new Set(words)],
            text: line.trim().slice(0, 160),
          });
        }
      });
    }
  }
  return findings;
}

// CLI entry: only when node was invoked on this file, not when vitest imports it.
if ((process.argv[1] ?? "").endsWith("check-english-only.mjs")) {
  const findings = findSpanish();
  if (findings.length === 0) {
    console.log("English-only check passed.");
    process.exit(0);
  }
  console.error(`English-only check failed — ${findings.length} line(s) look like Spanish:\n`);
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}  [${f.hits.join(", ")}]\n    ${f.text}`);
  }
  console.error(
    "\nTranslate the copy. If the Spanish is deliberate (a parser for Spanish input, a" +
      "\npersonal name in a fixture), add the file to ALLOWLIST in this script with a reason.",
  );
  process.exit(1);
}
