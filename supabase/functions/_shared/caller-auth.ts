// Caller gate for edge functions that the database calls (triggers, pg_cron)
// as well as other edge functions and the admin dashboard. ClickUp 86e40ach2,
// second pass X2-07 / X2-11..X2-14.
//
// These functions are public at the gateway (verify_jwt = false) because the
// database calls them with no user session. Before this gate, any holder of
// the public anon key could run them. Allowed callers now:
//
//   * another edge function presenting the service-role key;
//   * the database (trigger or cron) presenting the internal secret in the
//     `x-sync-secret` header. The secret lives in
//     public.ghl_calendar_sync_config.secret (row id = 1), which only the
//     database owner and the service role can read; the SQL helper
//     public._internal_call_headers() adds it to every pg_net call. The edge
//     function reads the same row with its service-role client, so no extra
//     Lovable secret is needed. BOOKING_SYNC_WEBHOOK_SECRET (env), when set,
//     is accepted too;
//   * optionally, a signed-in admin (the dashboard; functions.invoke forwards
//     the session token).
//
// Everything else is refused. A failed secret or role lookup is a refusal.

import { safeEqual, isServiceRoleRequest } from "./internal-auth.ts";
import { authorizeAdminOrService, supabaseAdminAuthDeps, type AdminAuthDeps } from "./admin-auth.ts";

export const INTERNAL_SECRET_HEADER = "x-sync-secret";

export type CallerAuthResult =
  | { ok: true; via: "service_role" }
  | { ok: true; via: "internal_secret" }
  | { ok: true; via: "admin"; userId: string }
  | { ok: false; status: 401 | 403; error: string };

export interface CallerAuthInput {
  authorizationHeader: string | null | undefined;
  providedSecret: string | null | undefined;
  serviceRoleKey: string | null | undefined;
  /** Every secret value currently accepted (DB row, env). Empty values are ignored. */
  loadSecrets: () => Promise<Array<string | null | undefined>>;
  /** Admin lookup; null when admins are not allowed for this function. */
  adminDeps: AdminAuthDeps | null;
}

/** Pure decision, injectable for tests. */
export async function decideCaller(input: CallerAuthInput): Promise<CallerAuthResult> {
  if (isServiceRoleRequest(input.authorizationHeader, input.serviceRoleKey)) {
    return { ok: true, via: "service_role" };
  }

  const provided = (input.providedSecret ?? "").trim();
  if (provided) {
    let secrets: Array<string | null | undefined> = [];
    try {
      secrets = await input.loadSecrets();
    } catch (_err) {
      secrets = [];
    }
    for (const s of secrets) {
      const expected = (s ?? "").trim();
      // A short or empty expected value never matches (unset config).
      if (expected.length >= 16 && safeEqual(provided, expected)) {
        return { ok: true, via: "internal_secret" };
      }
    }
  }

  if (input.adminDeps) {
    const admin = await authorizeAdminOrService(
      input.authorizationHeader,
      input.serviceRoleKey,
      input.adminDeps,
    );
    if (admin.ok && admin.via === "admin") return { ok: true, via: "admin", userId: admin.userId };
    if (admin.ok) return { ok: true, via: "service_role" };
    return admin;
  }

  return { ok: false, status: 401, error: "unauthorized" };
}

// Minimal supabase-js shape (keeps this module loadable from vitest).
interface SupabaseLike {
  auth: {
    getUser: (jwt: string) => Promise<{ data: { user: { id: string } | null }; error: unknown }>;
  };
  // deno-lint-ignore no-explicit-any
  from: (table: string) => any;
}

function env(name: string): string | undefined {
  // deno-lint-ignore no-explicit-any
  const d = (globalThis as any).Deno;
  return d?.env?.get?.(name) ?? undefined;
}

let cachedSecret: { value: string | null; at: number } | null = null;
const SECRET_CACHE_MS = 60_000;

/** The internal secret stored in the database (service-role read), cached per isolate. */
export async function loadDbInternalSecret(client: SupabaseLike): Promise<string | null> {
  if (cachedSecret && Date.now() - cachedSecret.at < SECRET_CACHE_MS) return cachedSecret.value;
  const { data, error } = await client
    .from("ghl_calendar_sync_config")
    .select("secret")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw error;
  const value = (data?.secret as string | null | undefined)?.trim() || null;
  cachedSecret = { value, at: Date.now() };
  return value;
}

/** Gate a request. `client` must be a service-role supabase-js client. */
export function authorizeInternalCaller(
  req: Request,
  client: SupabaseLike,
  opts: { allowAdmin?: boolean } = {},
): Promise<CallerAuthResult> {
  return decideCaller({
    authorizationHeader: req.headers.get("Authorization"),
    providedSecret: req.headers.get(INTERNAL_SECRET_HEADER),
    serviceRoleKey: env("SUPABASE_SERVICE_ROLE_KEY"),
    loadSecrets: async () => [await loadDbInternalSecret(client), env("BOOKING_SYNC_WEBHOOK_SECRET")],
    adminDeps: opts.allowAdmin === false ? null : supabaseAdminAuthDeps(client),
  });
}

export function callerRefusal(result: Extract<CallerAuthResult, { ok: false }>, cors: Record<string, string>): Response {
  return new Response(JSON.stringify({ ok: false, error: result.error }), {
    status: result.status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
