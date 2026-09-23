import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

// Enforces driver's license retention from the driver_license_uploads registry
// (migration 20260923180000):
//   * files never attached to a booking, 48h after upload,
//   * attached files, 30 days after the event (retain_until).
// Called hourly by pg_cron. Public on purpose: which files expire is decided
// entirely by the registry, which only the service role and a trigger can
// write, so calling this early or often can't delete anything ahead of policy.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BATCH = 500;

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data, error } = await supabase.rpc("expired_driver_license_paths", { p_limit: BATCH });
  if (error) {
    console.error("expired_driver_license_paths failed:", error);
    return reply({ error: error.message }, 500);
  }

  const paths = ((data ?? []) as { path: string }[]).map((r) => r.path);
  if (!paths.length) return reply({ expired: 0, removed: 0 });

  // Storage first: if this fails, the registry rows stay and the next run retries.
  const { data: gone, error: removeError } = await supabase.storage.from("driver-licenses").remove(paths);
  if (removeError) {
    console.error("driver-licenses remove failed:", removeError);
    return reply({ error: removeError.message }, 500);
  }

  const { error: deleteError } = await supabase.from("driver_license_uploads").delete().in("path", paths);
  if (deleteError) {
    console.error("driver_license_uploads delete failed:", deleteError);
    return reply({ error: deleteError.message }, 500);
  }

  console.log(`cleanup-driver-licenses: ${paths.length} expired, ${gone?.length ?? 0} objects removed`);
  return reply({ expired: paths.length, removed: gone?.length ?? 0 });
});
