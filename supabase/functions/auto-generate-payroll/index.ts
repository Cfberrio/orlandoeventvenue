import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

// Retired (ClickUp 86e40ach2, Phase 1B). This endpoint was public
// (verify_jwt=false, no auth check) and marked every past-event assignment
// completed — pending and rejected ones too — then generated payroll for it.
// It was not scheduled anywhere (config.toml cron is inactive in this project,
// no pg_cron job, no frontend caller). Completion and payroll now come from
// the database: auto_complete_assignments_on_in_progress (post_event,
// accepted only) and trg_complete_late_acceptance. Kept as an inert stub so the
// deployed function is replaced by something that touches nothing.
serve(() =>
  new Response(JSON.stringify({ error: "gone", message: "auto-generate-payroll has been retired" }), {
    status: 410,
    headers: { "Content-Type": "application/json" },
  })
);
