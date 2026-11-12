// Admin-or-service gate for edge functions that are public at the gateway
// (verify_jwt = false) but must only run for the office or for another edge
// function. ClickUp 86e40ach2, finding S-3: create-invoice and
// create-addon-invoice sent real Stripe payment links to any email for any
// caller holding the public anon key.
//
// Allowed callers:
//   * another edge function / cron relay presenting the service-role key
//     (process-recurring-invoices -> create-invoice);
//   * a signed-in Supabase user with role 'admin' in user_roles (the admin
//     dashboard; supabase.functions.invoke forwards the session token).
// Everything else — the anon key, an expired token, a signed-in user without
// the admin role — is refused before any database or Stripe work happens.

import { isServiceRoleRequest } from "./internal-auth.ts";

export type AdminAuthResult =
  | { ok: true; via: "service_role" }
  | { ok: true; via: "admin"; userId: string }
  | { ok: false; status: 401 | 403; error: string };

export interface AdminAuthDeps {
  /** Resolve a user JWT to a user id, or null when it is not a valid user session. */
  getUserId: (jwt: string) => Promise<string | null>;
  /** True when the user holds the admin role. */
  hasAdminRole: (userId: string) => Promise<boolean>;
}

export async function authorizeAdminOrService(
  authorizationHeader: string | null | undefined,
  serviceRoleKey: string | null | undefined,
  deps: AdminAuthDeps,
): Promise<AdminAuthResult> {
  if (isServiceRoleRequest(authorizationHeader, serviceRoleKey)) {
    return { ok: true, via: "service_role" };
  }

  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader ?? "");
  const token = match?.[1]?.trim();
  if (!token) {
    return { ok: false, status: 401, error: "Missing Authorization header" };
  }

  let userId: string | null = null;
  try {
    userId = await deps.getUserId(token);
  } catch (_err) {
    userId = null;
  }
  if (!userId) {
    return { ok: false, status: 401, error: "Invalid or expired session" };
  }

  let isAdmin = false;
  try {
    isAdmin = await deps.hasAdminRole(userId);
  } catch (_err) {
    // A failed role lookup is a refusal, never a pass.
    isAdmin = false;
  }
  if (!isAdmin) {
    return { ok: false, status: 403, error: "Admin access required" };
  }

  return { ok: true, via: "admin", userId };
}

// Minimal shape of the supabase-js client used below, so this module does not
// import supabase-js itself (keeps it loadable from the vitest edge suite).
interface SupabaseLike {
  auth: {
    getUser: (jwt: string) => Promise<{ data: { user: { id: string } | null }; error: unknown }>;
  };
  // deno-lint-ignore no-explicit-any
  from: (table: string) => any;
}

/** Deps backed by a service-role supabase-js client. */
export function supabaseAdminAuthDeps(client: SupabaseLike): AdminAuthDeps {
  return {
    getUserId: async (jwt) => {
      const { data, error } = await client.auth.getUser(jwt);
      if (error || !data?.user) return null;
      return data.user.id;
    },
    hasAdminRole: async (userId) => {
      const { data, error } = await client
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .eq("role", "admin")
        .limit(1);
      if (error) throw error;
      return Array.isArray(data) && data.length > 0;
    },
  };
}
