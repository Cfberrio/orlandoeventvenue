import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { decideGhlLifecycleWrite, type GhlLifecycleDecision } from "../_shared/ghl-lifecycle-guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-ghl-backend-token",
};

// Valid status values
const VALID_STATUSES = [
  "pending_review",
  "confirmed",
  "cancelled",
  "completed",
  "needs_info",
  "needs_payment",
  "declined",
];

const VALID_LIFECYCLE_STATUSES = [
  "pending",
  "confirmed",
  "pre_event_ready",
  "in_progress",
  "post_event",
  "closed_review_complete",
  "cancelled",
];

/**
 * Edge function called by GHL to update booking status/lifecycle_status.
 * Requires x-ghl-backend-token header for authentication.
 * GHL sends custom data under body.customData object.
 */
serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Only allow POST
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ ok: false, error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    // Validate GHL token
    const expectedToken = Deno.env.get("GHL_BACKEND_TOKEN");
    const incomingToken = req.headers.get("x-ghl-backend-token");

    if (!expectedToken || !incomingToken || incomingToken !== expectedToken) {
      console.error("Invalid or missing GHL token");
      return new Response(
        JSON.stringify({ ok: false, error: "Invalid or missing token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse request body safely
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      console.error("Failed to parse JSON body");
      return new Response(
        JSON.stringify({ ok: false, error: "Invalid JSON" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Log the full body for debugging
    console.log("GHL webhook body:", JSON.stringify(body, null, 2));

    // Extract customData - GHL wraps custom fields in customData object
    const customData = (body.customData ?? body.custom_data ?? {}) as Record<string, unknown>;

    // Extract booking_id with fallbacks
    const booking_id =
      customData.booking_id ??
      customData.bookingId ??
      body.booking_id ??
      null;

    // Extract status values with fallbacks
    const new_status =
      customData.new_status ??
      body.new_status ??
      null;

    const new_lifecycle_status =
      customData.new_lifecycle_status ??
      body.new_lifecycle_status ??
      null;

    // Validate required fields
    if (!booking_id) {
      console.error("booking_id is required. Body received:", JSON.stringify(body, null, 2));
      return new Response(
        JSON.stringify({ ok: false, error: "booking_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!new_status && !new_lifecycle_status) {
      return new Response(
        JSON.stringify({ ok: false, error: "At least one of new_status or new_lifecycle_status is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate status values if provided
    if (new_status && !VALID_STATUSES.includes(new_status as string)) {
      return new Response(
        JSON.stringify({ ok: false, error: `Invalid status: ${new_status}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (new_lifecycle_status && !VALID_LIFECYCLE_STATUSES.includes(new_lifecycle_status as string)) {
      return new Response(
        JSON.stringify({ ok: false, error: `Invalid lifecycle_status: ${new_lifecycle_status}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch current booking to verify it exists and get current values
    const { data: currentBooking, error: fetchError } = await supabase
      .from("bookings")
      .select("id, status, lifecycle_status")
      .eq("id", booking_id)
      .maybeSingle();

    if (fetchError) {
      console.error("Error fetching booking:", fetchError);
      return new Response(
        JSON.stringify({ ok: false, error: "Database error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!currentBooking) {
      return new Response(
        JSON.stringify({ ok: false, error: "Booking not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // "GHL proposes, the DB validates" (ClickUp 86e3zjfq6). The GHL workflows
    // still drive the lifecycle; each request is checked against
    // public.booking_readiness (the same rule the DB gate enforces).
    // Decide from the current lifecycle, write with compare-and-set on it, and
    // if a concurrent move changed it, re-read and decide again so an
    // accompanying status change (e.g. a cancellation) is never dropped.
    let from_status = currentBooking.status;
    let from_lifecycle = currentBooking.lifecycle_status;
    let applyLifecycle: string | null = null;
    let applyStatus: string | null = null;
    let lifecycleDecision: GhlLifecycleDecision | null = null;
    let readiness: { ready?: boolean; event_started?: boolean; unmet?: Array<{ message?: string }> } | null = null;
    let applied = false;

    for (let attempt = 1; attempt <= 3 && !applied; attempt++) {
      if (attempt > 1) {
        const { data: fresh, error: refetchError } = await supabase
          .from("bookings")
          .select("id, status, lifecycle_status")
          .eq("id", booking_id)
          .maybeSingle();
        if (refetchError || !fresh) {
          console.error("Error re-reading booking after concurrent change:", refetchError);
          return new Response(
            JSON.stringify({ ok: false, error: "Database error" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        from_status = fresh.status;
        from_lifecycle = fresh.lifecycle_status;
      }

      if (new_lifecycle_status) {
        const { data: r, error: readinessError } = await supabase.rpc("booking_readiness", { p_booking_id: booking_id });
        if (readinessError) {
          // Can't validate -> let GHL retry rather than guess.
          console.error("booking_readiness failed:", readinessError);
          return new Response(
            JSON.stringify({ ok: false, error: "readiness_check_failed", retryable: true }),
            { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        readiness = r;
      }

      lifecycleDecision = decideGhlLifecycleWrite(from_lifecycle, new_lifecycle_status as string | null, {
        eligible: readiness?.ready === true,
        eventStarted: readiness?.event_started === true,
      });
      applyLifecycle = lifecycleDecision?.kind === "apply" ? lifecycleDecision.lifecycle : null;

      // Cancelled is terminal for GHL: a stale callback must not reactivate a
      // cancelled booking (restoring one is an admin action).
      const isCancelled = from_status === "cancelled" || from_lifecycle === "cancelled";
      applyStatus = new_status && !(isCancelled && new_status !== "cancelled") && new_status !== from_status
        ? (new_status as string)
        : null;
      if (new_status && !applyStatus && new_status !== from_status) {
        const { error: statusLogError } = await supabase.from("booking_events").insert({
          booking_id,
          event_type: "ghl_status_ignored",
          channel: "ghl",
          metadata: { requested_status: new_status, current_status: from_status, current_lifecycle: from_lifecycle, reason: "booking_cancelled" },
        });
        if (statusLogError) console.error("Error logging ignored status write:", statusLogError);
      }

      if (!applyStatus && !applyLifecycle) {
        const deferred = lifecycleDecision?.kind === "defer";
        const reason = lifecycleDecision && lifecycleDecision.kind !== "apply" ? lifecycleDecision.reason : "nothing_to_apply";
        console.log(`GHL lifecycle write for ${booking_id} ${deferred ? "deferred" : "ignored"}: ${reason}`);
        const { error: logError } = await supabase.from("booking_events").insert({
          booking_id,
          event_type: deferred ? "ghl_lifecycle_deferred" : "ghl_lifecycle_ignored",
          channel: "ghl",
          metadata: {
            requested_lifecycle: new_lifecycle_status,
            current_lifecycle: from_lifecycle,
            reason,
            unmet: deferred ? (readiness?.unmet ?? []).map((u) => u.message) : undefined,
          },
        });
        if (logError) console.error("Error logging GHL lifecycle decision:", logError);
        // 200 so the GHL workflow does not retry: it fires again on the next
        // sync, when pre_event_ready_eligible / event_started change.
        return new Response(
          JSON.stringify({
            ok: true,
            booking_id,
            applied: false,
            deferred,
            reason,
            unmet: deferred ? (readiness?.unmet ?? []).map((u) => u.message) : undefined,
            new_status: from_status,
            new_lifecycle_status: from_lifecycle,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const updateData: Record<string, string> = {
        updated_at: new Date().toISOString(),
      };
      if (applyStatus) {
        updateData.status = applyStatus;
      }
      if (applyLifecycle) {
        updateData.lifecycle_status = applyLifecycle;
      }

      // Compare-and-set on BOTH fields we decided from.
      let updateQuery = supabase
        .from("bookings")
        .update(updateData)
        .eq("id", booking_id);
      updateQuery = from_lifecycle == null
        ? updateQuery.is("lifecycle_status", null)
        : updateQuery.eq("lifecycle_status", from_lifecycle);
      updateQuery = from_status == null
        ? updateQuery.is("status", null)
        : updateQuery.eq("status", from_status);
      const { data: updatedRows, error: updateError } = await updateQuery.select("id");

      if (updateError) {
        // 23514 = the DB readiness gate refused pre_event_ready (eligibility
        // was lost between our check and the write). Re-read and decide again.
        if ((updateError as { code?: string }).code === "23514") {
          console.log(`Readiness gate refused GHL pre_event_ready for ${booking_id}; re-evaluating`);
          continue;
        }
        console.error("Error updating booking:", updateError);
        return new Response(
          JSON.stringify({ ok: false, error: "DB update failed" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      applied = !!updatedRows && updatedRows.length > 0;
      if (!applied) {
        console.log(`Concurrent lifecycle change on ${booking_id} (was ${from_lifecycle}); retrying (attempt ${attempt})`);
      }
    }

    if (!applied) {
      // Non-2xx so GHL retries: the status change has NOT been applied.
      return new Response(
        JSON.stringify({ ok: false, error: "stale_lifecycle_changed_concurrently", retryable: true }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (lifecycleDecision && lifecycleDecision.kind !== "apply") {
      // Status was applied, lifecycle part was not: leave a trace.
      const { error: partialLogError } = await supabase.from("booking_events").insert({
        booking_id,
        event_type: lifecycleDecision.kind === "defer" ? "ghl_lifecycle_deferred" : "ghl_lifecycle_ignored",
        channel: "ghl",
        metadata: {
          requested_lifecycle: new_lifecycle_status,
          current_lifecycle: from_lifecycle,
          reason: lifecycleDecision.reason,
        },
      });
      if (partialLogError) console.error("Error logging GHL lifecycle decision:", partialLogError);
    }

    // Log the status change in booking_events
    const { error: eventError } = await supabase
      .from("booking_events")
      .insert({
        booking_id,
        event_type: "ghl_status_change",
        channel: "ghl",
        metadata: {
          from_status,
          to_status: applyStatus || from_status,
          from_lifecycle,
          to_lifecycle: applyLifecycle || from_lifecycle,
          timestamp: new Date().toISOString(),
        },
      });

    if (eventError) {
      console.error("Error logging event:", eventError);
      // Don't fail the request, just log the error
    }

    console.log(`Booking ${booking_id} updated: status=${applyStatus || 'unchanged'}, lifecycle=${applyLifecycle || 'unchanged'}`);

    return new Response(
      JSON.stringify({
        ok: true,
        booking_id,
        new_status: applyStatus || from_status,
        new_lifecycle_status: applyLifecycle || from_lifecycle,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: unknown) {
    console.error("Error in ghlUpdateBookingStatus:", err);
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    return new Response(
      JSON.stringify({ ok: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});