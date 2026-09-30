import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

interface FollowUpResult {
  ok: boolean;
  skipped?: boolean;
  status?: number;
  detail?: unknown;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Only allow POST
  if (req.method !== "POST") {
    return jsonResponse(
      { ok: false, error: "method_not_allowed", message: "Only POST requests are supported" },
      405,
    );
  }

  try {
    // Get auth token
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ ok: false, error: "unauthorized", message: "Missing Authorization header" }, 401);
    }

    const token = authHeader.replace("Bearer ", "");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Create client with user token for auth check
    const supabaseClient = createClient(supabaseUrl, supabaseServiceKey, {
      global: {
        headers: { Authorization: authHeader },
      },
    });

    // Verify user is authenticated
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);

    if (authError || !user) {
      console.error("Auth error:", authError);
      return jsonResponse({ ok: false, error: "invalid_token", message: "Invalid or expired token" }, 401);
    }

    // Check if user is admin
    const { data: roles, error: roleError } = await supabaseClient
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .limit(1);

    if (roleError || !roles || roles.length === 0) {
      console.error("Role check failed:", roleError);
      return jsonResponse(
        { ok: false, error: "admin_required", message: "Admin access required to reschedule bookings" },
        403,
      );
    }

    // Parse request body
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ ok: false, error: "invalid_body", message: "Request body must be JSON" }, 400);
    }
    const {
      booking_id,
      event_date,
      start_time,
      end_time,
      // booking_type removed - booking type never changes
      reason,
    } = body as Record<string, string | null | undefined>;

    // Validate required fields
    if (!booking_id || !event_date) {
      return jsonResponse(
        {
          ok: false,
          error: "validation_failed",
          message: "Missing required fields",
          missing_fields: [
            ...(!booking_id ? ["booking_id"] : []),
            ...(!event_date ? ["event_date"] : []),
          ],
        },
        400,
      );
    }

    console.log("=== reschedule-booking ===");
    console.log("Booking ID:", booking_id);
    console.log("New date:", event_date);
    console.log("Actor:", user.id);

    // Service-role client with no user token: reschedule_booking is only
    // executable by service_role, so it can only run after the admin check
    // above (anon/authenticated could call it directly before).
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    // Call RPC function: validates, updates the booking, moves its
    // availability block, shifts (or cancels past-due) pending jobs and writes
    // the audit event, all in one transaction.
    const { data: rpcResult, error: rpcError } = await serviceClient.rpc(
      "reschedule_booking",
      {
        p_booking_id: booking_id,
        p_new_date: event_date,
        p_new_start_time: start_time || null,
        p_new_end_time: end_time || null,
        // p_new_booking_type removed - booking type never changes
        p_reason: reason || null,
        p_actor_id: user.id,
      }
    );

    if (rpcError || !rpcResult) {
      console.error("RPC error:", rpcError);
      return jsonResponse(
        {
          ok: false,
          error: "rpc_failed",
          message: "Database operation failed",
          detail: rpcError?.message ?? "empty RPC result",
        },
        500,
      );
    }

    // Check RPC result
    if (!rpcResult.ok) {
      // Return business error (conflict, validation, etc)
      console.log("RPC returned error:", rpcResult.error);
      return jsonResponse(rpcResult); // Business error, not HTTP error
    }

    console.log("Booking rescheduled:", JSON.stringify({
      changed: rpcResult.changed,
      jobs_updated: rpcResult.jobs_updated,
      jobs_cancelled_past_due: rpcResult.jobs_cancelled_past_due,
      blocks_moved: rpcResult.blocks_moved,
      date_shift_days: rpcResult.date_shift_days,
    }));

    // The RPC only shifts jobs by whole days and cannot see time-of-day
    // changes, the 15-day balance rule or the host-report windows. Rebuild
    // every event-anchored job from the booking's new row. Each step is
    // independent: a failure is reported, the next step still runs.
    //
    // This also runs when nothing changed (changed=false): re-submitting the
    // same date is how an admin retries follow-ups that failed the first
    // time. Every step is idempotent against the current row: the host step
    // is only written when it differs, one_hour_report only reopens on a date
    // change, and a balance link is only created if none was ever sent.
    const callFunction = async (name: string, payload: Record<string, unknown>): Promise<FollowUpResult> => {
      try {
        const res = await fetch(`${supabaseUrl}/functions/v1/${name}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify(payload),
        });
        const text = await res.text();
        let detail: unknown = text;
        try {
          detail = JSON.parse(text);
        } catch {
          // keep raw text
        }
        // sync-to-ghl answers HTTP 200 with {ok:false} when GHL rejects the
        // snapshot, and the schedulers report {success:false}: both are
        // failures even though the HTTP status is fine.
        const body = detail && typeof detail === "object" ? detail as Record<string, unknown> : {};
        const ok = res.ok && body.ok !== false && body.success !== false;
        if (!ok) console.error(`${name} failed (${res.status}):`, text);
        return { ok, status: res.status, detail };
      } catch (err) {
        console.error(`${name} exception:`, err);
        return { ok: false, detail: err instanceof Error ? err.message : String(err) };
      }
    };

    const lifecycle = rpcResult.lifecycle_status as string | null;
    const followUps: Record<string, FollowUpResult> = {};

    // Host report chain (30/7/1 day steps + one_hour_report).
    // trigger-booking-automation creates it from the first paid state on
    // (pending/confirmed included), so rebuild it for every lifecycle that
    // still has an event ahead. Unpaid leads never get one.
    const paymentStatus = rpcResult.payment_status as string | null;
    if (lifecycle && !["post_event", "cancelled"].includes(lifecycle) && paymentStatus !== "pending") {
      followUps.host_report = await callFunction("schedule-host-report-reminders", {
        booking_id,
        force_reschedule: true,
      });
    } else {
      followUps.host_report = {
        ok: true,
        skipped: true,
        detail: `lifecycle ${lifecycle}, payment ${paymentStatus}`,
      };
    }

    // Post-event guest feedback email (end + 30 min).
    followUps.guest_feedback = await callFunction("schedule-guest-feedback", {
      booking_id,
      force_reschedule: true,
    });

    // set_lifecycle_in_progress (event start) + remaining balance chain
    // (T-15 retries, or an immediate link when the new date is ≤15 days out
    // and none was sent). The function itself skips fully_paid bookings and
    // policies that don't collect payment.
    followUps.balance = await callFunction("schedule-balance-payment", {
      booking_id,
      force_reschedule: true,
    });

    // Last: push the final snapshot (event_date, times, host_report_step,
    // balance link) to the GHL booking webhook. The bookings trigger only
    // moves the GHL calendar appointment, not the contact fields.
    followUps.ghl_sync = await callFunction("sync-to-ghl", {
      booking_id,
      sync_reason: "booking_rescheduled",
    });

    const warnings = Object.entries(followUps)
      .filter(([, r]) => !r.ok)
      .map(([step]) => step);

    const { error: followUpEventError } = await serviceClient.from("booking_events").insert({
      booking_id,
      event_type: warnings.length ? "booking_reschedule_followups_failed" : "booking_reschedule_followups_done",
      channel: "system",
      metadata: {
        warnings,
        follow_ups: Object.fromEntries(
          Object.entries(followUps).map(([k, r]) => [k, { ok: r.ok, skipped: r.skipped ?? false, status: r.status }]),
        ),
      },
    });
    if (followUpEventError) {
      console.error("Failed to log reschedule follow-ups:", followUpEventError);
    }

    // Return success response: the reschedule itself is committed; warnings
    // list the follow-up steps an admin should re-check.
    return jsonResponse({
      ...rpcResult,
      follow_ups: followUps,
      warnings,
      // Kept for callers of the previous response shape.
      host_report_rescheduled: followUps.host_report.ok && !followUps.host_report.skipped,
      guest_feedback_rescheduled: followUps.guest_feedback.ok,
    });
  } catch (error) {
    console.error("Unexpected error:", error);
    const errorMessage = error instanceof Error ? error.message : "An unexpected error occurred";
    return jsonResponse({ ok: false, error: "unexpected_error", message: errorMessage }, 500);
  }
});
