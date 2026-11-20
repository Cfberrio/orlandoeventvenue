import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

// Retired (ClickUp 86e40ach2, second pass X2-04). This endpoint was public
// (verify_jwt=false, no auth check). It inserted two real bookings with a
// caller-supplied name and email, synced them to real GHL contacts and the GHL
// calendar, then deleted them. Kept as an inert stub so the deployed function
// is replaced by something that touches nothing; delete the function in
// Supabase once the stub is confirmed live.
serve(() =>
  new Response(JSON.stringify({ error: "gone", message: "test-ghl-calendar-sync has been retired" }), {
    status: 410,
    headers: { "Content-Type": "application/json" },
  })
);
