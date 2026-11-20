import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

// Retired (ClickUp 86e40ach2, second pass X2-07). This endpoint was public
// (verify_jwt=false, no auth check) and returned guest names, emails,
// reservation numbers and statuses. Nothing calls it (no frontend, function,
// trigger or cron caller). Kept as an inert stub so the deployed function is
// replaced by something that touches nothing; delete the function in Supabase
// once the stub is confirmed live. daily-health-check covers monitoring.
serve(() =>
  new Response(JSON.stringify({ error: "gone", message: "get-system-metrics has been retired" }), {
    status: 410,
    headers: { "Content-Type": "application/json" },
  })
);
