import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

// Retired (ClickUp 86e40ach2, finding S-4). This endpoint used to insert and
// delete a real booking in production and fire the booking automations, with
// no authentication. It is kept as an inert stub so the deployed function is
// replaced by something that touches nothing; delete the directory once the
// stub is confirmed live and the function is removed from the project.
serve(() =>
  new Response(JSON.stringify({ error: "gone", message: "test-trigger-automation has been retired" }), {
    status: 410,
    headers: { "Content-Type": "application/json" },
  })
);
