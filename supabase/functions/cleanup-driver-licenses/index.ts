import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

// Deletes driver's license files that no booking references after 48h:
// abandoned checkouts, failed half-uploads, and files a guest replaced.
// Called hourly by pg_cron (migration 20260923170000). Safe to call by anyone:
// it only ever removes unreferenced files older than the grace window, and
// deleting through the Storage API also removes the underlying object.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BATCH = 500;

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data, error } = await supabase.rpc("orphan_driver_license_paths", { p_limit: BATCH });
  if (error) {
    console.error("orphan_driver_license_paths failed:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }

  const paths = ((data ?? []) as { name: string }[]).map((r) => r.name);
  let removed = 0;
  if (paths.length) {
    const { data: gone, error: removeError } = await supabase.storage.from("driver-licenses").remove(paths);
    if (removeError) {
      console.error("driver-licenses remove failed:", removeError);
      return new Response(JSON.stringify({ error: removeError.message }), { status: 500, headers: corsHeaders });
    }
    removed = gone?.length ?? 0;
  }

  console.log(`cleanup-driver-licenses: ${paths.length} orphans found, ${removed} removed`);
  return new Response(JSON.stringify({ found: paths.length, removed }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
