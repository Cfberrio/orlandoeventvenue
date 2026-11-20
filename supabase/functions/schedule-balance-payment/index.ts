import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { BALANCE_JOB_TYPES, calendarDaysBetween, planBalanceReissue, planBalanceReschedule } from "../_shared/reschedule-plan.ts";
import { policyAllows } from "../_shared/guest-timeline.ts";
import { isServiceRoleRequest } from "../_shared/internal-auth.ts";

import { withBuild } from "../_shared/build-info.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALERT_EMAIL = "orlandoglobalministries@gmail.com";

/**
 * Send instant critical failure alert email
 */
async function sendCriticalAlert(functionName: string, reservationNumber: string, errorMsg: string, bookingId?: string): Promise<void> {
  try {
    const gmailUser = Deno.env.get("GMAIL_USER");
    const gmailPassword = Deno.env.get("GMAIL_APP_PASSWORD");
    if (!gmailUser || !gmailPassword) return;

    const client = new SMTPClient({
      connection: { hostname: "smtp.gmail.com", port: 465, tls: true, auth: { username: gmailUser, password: gmailPassword } },
    });

    const timestamp = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
    const html = `<html><body style="font-family:Arial;padding:20px;"><h2 style="color:#dc2626;">CRITICAL FAILURE: ${functionName}</h2><p><b>Reservation:</b> ${reservationNumber}</p><p><b>Error:</b> ${errorMsg}</p><p><b>Time:</b> ${timestamp} ET</p>${bookingId ? `<p><b>Booking ID:</b> ${bookingId}</p>` : ""}<p style="margin-top:20px;color:#666;">This is an automated alert - immediate action required.</p></body></html>`;

    await client.send({
      from: `"OEV Alert" <${gmailUser}>`,
      to: ALERT_EMAIL,
      subject: `🚨 CRITICAL: ${functionName} Failed for ${reservationNumber}`,
      html,
    });
    await client.close();
    console.log(`[ALERT] Critical failure alert sent for ${reservationNumber}`);
  } catch (alertErr) {
    console.error("[ALERT] Failed to send critical alert:", alertErr);
  }
}

/**
 * Records jobs that could not be scheduled (audit Phase 2 follow-up): marks the
 * response, logs a critical-failure event and emails the alert inbox. Never throws.
 */
async function reportFailedJobs(
  supabase: any,
  booking: { id: string; reservation_number: string | null },
  failedJobs: string[],
  responseData: Record<string, unknown>,
): Promise<void> {
  if (failedJobs.length === 0) return;
  responseData.success = false;
  responseData.jobs_failed = failedJobs;
  const message = `Could not schedule ${failedJobs.length} job(s): ${failedJobs.join("; ")}`;
  await logCriticalError(supabase, booking.id, "schedule-balance-payment", new Error(message));
  await sendCriticalAlert("schedule-balance-payment", booking.reservation_number || booking.id, message, booking.id);
}

/**
 * Log critical error to booking_events table
 */
async function logCriticalError(supabase: any, bookingId: string, functionName: string, error: Error): Promise<void> {
  try {
    await supabase.from("booking_events").insert({
      booking_id: bookingId,
      event_type: `${functionName.replace(/-/g, "_")}_critical_failure`,
      channel: "system",
      metadata: {
        error_message: error.message,
        error_stack: error.stack?.substring(0, 500),
        timestamp: new Date().toISOString(),
        requires_manual_intervention: true,
      },
    });
  } catch (logErr) {
    console.error("Failed to log critical error:", logErr);
  }
}

const ORLANDO_TZ = "America/New_York";

/**
 * Millisecond offset of a timezone at a given instant (offset = tzWallClock - UTC).
 */
function tzOffsetMs(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(date)) parts[p.type] = p.value;
  const asIfUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    parts.hour === "24" ? 0 : Number(parts.hour), Number(parts.minute), Number(parts.second),
  );
  return asIfUtc - date.getTime();
}

/**
 * Converts a date + time interpreted as Orlando local time (DST-aware) to UTC.
 */
function orlandoLocalToUTC(dateStr: string, timeStr: string): Date {
  const asUtcMs = Date.parse(`${dateStr}T${timeStr}Z`);
  const offset = tzOffsetMs(new Date(asUtcMs), ORLANDO_TZ);
  return new Date(asUtcMs - offset);
}

/** Whole calendar days from today (as seen in Orlando) to the event date. */
function daysUntilEventOrlando(eventDate: string, now: Date): number {
  // Today's date as seen in Orlando, not on the (UTC) runtime clock — between
  // 19:00 and 24:00 Orlando those are different days.
  const orlandoToday = new Intl.DateTimeFormat("en-CA", {
    timeZone: ORLANDO_TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
  return calendarDaysBetween(orlandoToday, eventDate);
}

/**
 * force_reschedule path (called by reschedule-booking after the date moved):
 * cancel the pending balance jobs and rebuild them from the current
 * event_date. The decision itself lives in planBalanceReschedule so it is
 * unit-tested; this only applies it. Jobs are inserted before any link is
 * created, so a failed link still leaves the retry in place.
 */
// deno-lint-ignore no-explicit-any
async function rescheduleBalanceJobs(supabase: any, supabaseUrl: string, booking: any, responseData: Record<string, unknown>): Promise<Response> {
  const booking_id = booking.id;
  const jsonResponse = (data: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  const { data: cancelledJobs, error: cancelError } = await supabase
    .from("scheduled_jobs")
    .update({
      status: "cancelled",
      last_error: "force_reschedule",
      updated_at: new Date().toISOString(),
    })
    .eq("booking_id", booking_id)
    .in("job_type", [...BALANCE_JOB_TYPES])
    .eq("status", "pending")
    .select("job_type");

  if (cancelError) {
    throw new Error(`Failed to cancel balance jobs for reschedule: ${cancelError.message}`);
  }

  const { data: completedJobs, error: completedError } = await supabase
    .from("scheduled_jobs")
    .select("job_type")
    .eq("booking_id", booking_id)
    .in("job_type", [...BALANCE_JOB_TYPES])
    .eq("status", "completed");

  if (completedError) {
    throw new Error(`Failed to read balance job history: ${completedError.message}`);
  }

  const cancelledPendingTypes: string[] = (cancelledJobs ?? []).map((j: { job_type: string }) => j.job_type);
  const completedTypes: string[] = (completedJobs ?? []).map((j: { job_type: string }) => j.job_type);
  // Only a stored URL proves a link reached the guest: process-scheduled-jobs
  // also marks retries 'completed' when it skips them (deposit not paid yet).
  const linkAlreadySent = Boolean(booking.balance_payment_url);
  const now = new Date();
  const diffDays = daysUntilEventOrlando(booking.event_date, now);

  const plan = planBalanceReschedule({
    diffDays,
    linkAlreadySent,
    completedTypes,
    eventAnchorMs: orlandoLocalToUTC(booking.event_date, "09:00:00").getTime(),
    eventStartMs: orlandoLocalToUTC(booking.event_date, booking.start_time || "00:00:00").getTime(),
    nowMs: now.getTime(),
  });

  console.log(
    `[RESCHEDULE] balance plan=${plan.action} days_until_event=${diffDays} ` +
    `link_already_sent=${linkAlreadySent} cancelled=${cancelledPendingTypes.join(",") || "none"} ` +
    `completed=${completedTypes.join(",") || "none"} ` +
    `jobs=${plan.jobs.map((j) => `${j.job_type}@${j.run_at}`).join(",") || "none"}`
  );

  // CM2-04: T-3 / T-1 re-issues, spaced from the sends planned above.
  const reissue = planBalanceReissue({
    eventAnchorMs: orlandoLocalToUTC(booking.event_date, "09:00:00").getTime(),
    eventStartMs: orlandoLocalToUTC(booking.event_date, booking.start_time || "00:00:00").getTime(),
    nowMs: now.getTime(),
    otherSendsMs: [
      ...plan.jobs.map((j) => Date.parse(j.run_at)),
      ...(plan.action === "short_notice_create_now" ? [now.getTime()] : []),
    ],
    completedTypes,
  });
  const allJobs: { job_type: string; run_at: string }[] = [...plan.jobs, ...reissue];

  if (allJobs.length > 0) {
    const { error: insertError } = await supabase
      .from("scheduled_jobs")
      .insert(allJobs.map((j) => ({ ...j, booking_id, status: "pending" })));

    if (insertError) {
      throw new Error(`Failed to recreate balance jobs: ${insertError.message}`);
    }
  }

  responseData.balance_action = plan.action;
  responseData.balance_jobs = allJobs;
  responseData.balance_jobs_cancelled = cancelledPendingTypes;
  responseData.days_until_event = diffDays;

  if (plan.action === "short_notice_create_now") {
    const response = await fetch(`${supabaseUrl}/functions/v1/create-balance-payment-link`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-ghl-backend-token": Deno.env.get("GHL_BACKEND_TOKEN") || "",
      },
      // One key per booking: this path only runs when no link was ever sent,
      // so there is exactly one "first link" per booking. Overlapping
      // reschedules get the same Stripe session, or — if they moved to
      // different dates and the session params differ — Stripe rejects the
      // second call instead of creating a second payable link.
      body: JSON.stringify({
        booking_id,
        idempotency_key: `oev-balance-first-link:${booking_id}`,
      }),
    });
    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error("[RESCHEDULE] Failed to create balance payment link:", result);
      return jsonResponse({
        ...responseData,
        success: false,
        error: "Failed to create balance payment link",
        details: result,
      }, 500);
    }
    responseData.balance_link_created = true;
  }

  const { error: eventError } = await supabase.from("booking_events").insert({
    booking_id,
    event_type: "balance_payment_rescheduled",
    channel: "system",
    metadata: {
      action: plan.action,
      event_date: booking.event_date,
      days_until_event: diffDays,
      link_already_sent: linkAlreadySent,
      cancelled_types: cancelledPendingTypes,
      completed_types: completedTypes,
      jobs: allJobs,
      link_created: plan.action === "short_notice_create_now",
    },
  });
  if (eventError) {
    console.error("[RESCHEDULE] Failed to log balance_payment_rescheduled:", eventError);
  }

  return jsonResponse(responseData);
}

/** Inserts the T-3 / T-1 balance re-issue jobs; a failure is reported, never thrown. */
// deno-lint-ignore no-explicit-any
async function insertReissueJobs(supabase: any, bookingId: string, jobs: { job_type: string; run_at: string }[], failedJobs: string[]): Promise<void> {
  if (jobs.length === 0) return;
  const { error } = await supabase
    .from("scheduled_jobs")
    .insert(jobs.map((j) => ({ ...j, booking_id: bookingId, status: "pending" })));
  if (error) {
    console.error("Failed to schedule balance re-issue jobs:", error);
    failedJobs.push(`balance_reissue: ${error.message}`);
    return;
  }
  const { error: eventError } = await supabase.from("booking_events").insert({
    booking_id: bookingId,
    event_type: "balance_payment_retry_scheduled",
    channel: "system",
    metadata: { type: "reissue", jobs },
  });
  if (eventError) console.error("Failed to log balance re-issue jobs:", eventError);
}

serve(withBuild(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const booking_id = body.booking_id;
    // Set by reschedule-booking: rebuild the lifecycle + balance jobs from the
    // booking's current date instead of skipping because jobs already exist.
    const force_reschedule = body.force_reschedule === true;

    // Rebuilding cancels jobs and can create a payment link: internal only.
    if (force_reschedule && !isServiceRoleRequest(
      req.headers.get("Authorization"),
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    )) {
      return new Response(JSON.stringify({ error: "force_reschedule requires internal auth" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!booking_id) {
      return new Response(JSON.stringify({ error: "booking_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("=== schedule-balance-payment ===");
    console.log("Processing booking:", booking_id);

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch booking details with policy
    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select("*, booking_policies(*)")
      .eq("id", booking_id)
      .single();

    if (bookingError || !booking) {
      console.error("Booking not found:", bookingError);
      return new Response(JSON.stringify({ error: "Booking not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // [POLICY GUARD] Check if payment processing is required for this booking
    // (CM2-15: send_balance_emails=false also means no balance emails/links).
    if (booking.booking_policies && (booking.booking_policies.requires_payment === false
        || !policyAllows(booking.booking_policies, "send_balance_emails"))) {
      console.log(
        `[POLICY_SKIP] Balance payment scheduling skipped ` +
        `(booking: ${booking_id}, origin: ${booking.booking_origin}, ` +
        `policy: ${booking.booking_policies.policy_name})`
      );
      return new Response(
        JSON.stringify({ 
          success: true, 
          skipped: true,
          reason: "policy_requires_payment_false",
          booking_id,
          reservation_number: booking.reservation_number
        }), 
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const responseData: Record<string, unknown> = {
      success: true,
      booking_id,
      reservation_number: booking.reservation_number,
    };
    // Jobs whose insert failed. The response stays 200 (stripe-webhook and
    // trigger-booking-automation only check response.ok and must not change
    // behavior), but a failure is now recorded and alerted instead of lost.
    const failedJobs: string[] = [];

    // ===============================
    // PART 1: Schedule lifecycle transition job (set_lifecycle_in_progress)
    // ===============================
    // confirmed too: a booking waiting on staff acceptance still needs its
    // event-start job, and a reschedule must move it (ClickUp 86e3zjfq6).
    if (["confirmed", "pre_event_ready"].includes(booking.lifecycle_status) && booking.event_date) {
      if (force_reschedule) {
        const { error: cancelLifecycleError } = await supabase
          .from("scheduled_jobs")
          .update({
            status: "cancelled",
            last_error: "force_reschedule",
            updated_at: new Date().toISOString(),
          })
          .eq("booking_id", booking_id)
          .eq("job_type", "set_lifecycle_in_progress")
          .eq("status", "pending");

        if (cancelLifecycleError) {
          throw new Error(`Failed to cancel lifecycle job for reschedule: ${cancelLifecycleError.message}`);
        }
      }

      const { data: existingLifecycleJob } = await supabase
        .from("scheduled_jobs")
        .select("id")
        .eq("booking_id", booking_id)
        .eq("job_type", "set_lifecycle_in_progress")
        .in("status", ["pending"]);

      if (!existingLifecycleJob || existingLifecycleJob.length === 0) {
        let runAt: Date;
        if (booking.start_time) {
          // Combine event_date with start_time (Orlando local -> UTC)
          runAt = orlandoLocalToUTC(booking.event_date, booking.start_time);
        } else {
          // L2-15: same rule as _booking_event_start_at (no start time = 00:00),
          // which the lifecycle cron and "Close event" use.
          runAt = orlandoLocalToUTC(booking.event_date, "00:00:00");
        }

        const { error: lifecycleJobError } = await supabase
          .from("scheduled_jobs")
          .insert({
            job_type: "set_lifecycle_in_progress",
            booking_id: booking_id,
            run_at: runAt.toISOString(),
            status: "pending",
          });

        if (lifecycleJobError) {
          console.error("Failed to schedule lifecycle job:", lifecycleJobError);
          // The pending job was just cancelled above; don't leave the booking
          // without one silently.
          if (force_reschedule) {
            throw new Error(`Failed to recreate lifecycle job: ${lifecycleJobError.message}`);
          }
          failedJobs.push(`set_lifecycle_in_progress: ${lifecycleJobError.message}`);
        } else {
          console.log(`Scheduled set_lifecycle_in_progress for: ${runAt.toISOString()}`);
          
          await supabase.from("booking_events").insert({
            booking_id: booking_id,
            event_type: "lifecycle_transition_scheduled",
            channel: "system",
            metadata: {
              job_type: "set_lifecycle_in_progress",
              scheduled_for: runAt.toISOString(),
              from_lifecycle: booking.lifecycle_status,
              to_lifecycle: "in_progress",
            },
          });

          responseData.lifecycle_job_scheduled = true;
          responseData.lifecycle_job_run_at = runAt.toISOString();
        }
      } else {
        console.log("Lifecycle job already exists for this booking, skipping");
        responseData.lifecycle_job_scheduled = false;
        responseData.lifecycle_job_reason = "already_exists";
      }
    }

    // ===============================
    // PART 2: Balance payment scheduling (ONLY balance - no host report logic)
    // ===============================

    // Skip if not deposit_paid
    if (booking.payment_status !== "deposit_paid") {
      console.log("Skipping balance payment scheduling - payment status is not deposit_paid:", booking.payment_status);
      responseData.balance_action = "skipped";
      responseData.balance_reason = `Payment status is ${booking.payment_status}, not deposit_paid`;
      
      await reportFailedJobs(supabase, booking, failedJobs, responseData);
      return new Response(JSON.stringify(responseData), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Skip if already fully paid
    if (booking.payment_status === "fully_paid") {
      console.log("Skipping balance payment scheduling - already fully paid");
      responseData.balance_action = "skipped";
      responseData.balance_reason = "Already fully paid";
      
      await reportFailedJobs(supabase, booking, failedJobs, responseData);
      return new Response(JSON.stringify(responseData), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (force_reschedule) {
      return await rescheduleBalanceJobs(supabase, supabaseUrl, booking, responseData);
    }

    // Check if any balance jobs are already scheduled for this booking
    const { data: existingJobs } = await supabase
      .from("scheduled_jobs")
      .select("id, job_type")
      .eq("booking_id", booking_id)
      .in("job_type", [...BALANCE_JOB_TYPES])
      .in("status", ["pending", "completed"]);

    if (existingJobs && existingJobs.length > 0) {
      console.log("Skipping - balance jobs already exist for this booking:", existingJobs.map(j => j.job_type));
      responseData.balance_action = "skipped";
      responseData.balance_reason = "Balance payment jobs already scheduled";

      await reportFailedJobs(supabase, booking, failedJobs, responseData);
      return new Response(JSON.stringify(responseData), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Calculate days until event (using Orlando timezone)
    const now = new Date();
    const diffDays = daysUntilEventOrlando(booking.event_date, now);

    console.log(`Event date: ${booking.event_date}, Days until event: ${diffDays}`);

    // Helper to add hours to a date
    const addHours = (date: Date, hours: number) => new Date(date.getTime() + hours * 60 * 60 * 1000);

    if (diffDays <= 15) {
      // ===============================
      // SHORT NOTICE: Max 2 balance links
      // ===============================
      console.log("Short notice booking (≤15 days) - creating link immediately + scheduling 1 retry");
      
      // 1) Create balance payment link immediately (first link)
      const response = await fetch(
        `${supabaseUrl}/functions/v1/create-balance-payment-link`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-ghl-backend-token": Deno.env.get("GHL_BACKEND_TOKEN") || "",
          },
          body: JSON.stringify({ booking_id }),
        }
      );

      const result = await response.json();
      
      if (!response.ok) {
        console.error("Failed to create initial balance payment link:", result);
        // Alert it (and any lifecycle-job failure from this run) before the 500.
        failedJobs.push(`create_balance_payment_link: HTTP ${response.status}`);
        await reportFailedJobs(supabase, booking, failedJobs, responseData);
        return new Response(JSON.stringify({  
          ...responseData,
          success: false, 
          error: "Failed to create balance payment link",
          details: result
        }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      console.log("First balance payment link created:", result.payment_url);

      // Log event for first link
      await supabase.from("booking_events").insert({
        booking_id: booking_id,
        event_type: "balance_payment_retry_scheduled",
        channel: "system",
        metadata: {
          attempt: 1,
          type: "short_notice",
          days_until_event: diffDays,
          created_immediately: true,
        },
      });

      // 2) Schedule retry #2 for 48 hours later
      const retryAt = addHours(new Date(), 48);

      const { error: insertError } = await supabase
        .from("scheduled_jobs")
        .insert({
          job_type: "balance_retry_2",
          booking_id: booking_id,
          run_at: retryAt.toISOString(),
          status: "pending",
        });

      if (insertError) {
        console.error("Failed to schedule retry job:", insertError);
        failedJobs.push(`balance_retry_2: ${insertError.message}`);
      } else {
        console.log(`Scheduled balance_retry_2 for: ${retryAt.toISOString()}`);
        
        await supabase.from("booking_events").insert({
          booking_id: booking_id,
          event_type: "balance_payment_retry_scheduled",
          channel: "system",
          metadata: {
            attempt: 2,
            type: "short_notice",
            scheduled_for: retryAt.toISOString(),
          },
        });
      }

      // CM2-04: re-issue at T-3 / T-1 (skipped when within 24h of another send).
      const shortReissue = planBalanceReissue({
        eventAnchorMs: orlandoLocalToUTC(booking.event_date, "09:00:00").getTime(),
        eventStartMs: orlandoLocalToUTC(booking.event_date, booking.start_time || "00:00:00").getTime(),
        nowMs: now.getTime(),
        otherSendsMs: [now.getTime(), retryAt.getTime()],
      });
      await insertReissueJobs(supabase, booking_id, shortReissue, failedJobs);

      responseData.balance_action = "short_notice";
      responseData.balance_link_created = true;
      responseData.balance_retry_scheduled = retryAt.toISOString();
      responseData.balance_reissues_scheduled = shortReissue;
      responseData.days_until_event = diffDays;

    } else {
      // ===============================
      // LONG NOTICE: Schedule 3 balance retries
      // ===============================
      console.log("Long notice booking (>15 days) - scheduling 3 balance payment retries");

      // Calculate the first retry at T-15 days (9 AM Orlando time)
      const eventDateObj = orlandoLocalToUTC(booking.event_date, "09:00:00");
      const fifteenDaysBefore = new Date(eventDateObj.getTime() - 15 * 24 * 60 * 60 * 1000);
      
      // Retry 1: T-15 days
      const retry1At = fifteenDaysBefore;
      // Retry 2: 48h after retry 1
      const retry2At = addHours(retry1At, 48);
      // Retry 3: 48h after retry 2
      const retry3At = addHours(retry2At, 48);

      const retries = [
        { job_type: "balance_retry_1", run_at: retry1At },
        { job_type: "balance_retry_2", run_at: retry2At },
        { job_type: "balance_retry_3", run_at: retry3At },
      ];

      for (const retry of retries) {
        const { error: insertError } = await supabase
          .from("scheduled_jobs")
          .insert({
            job_type: retry.job_type,
            booking_id: booking_id,
            run_at: retry.run_at.toISOString(),
            status: "pending",
          });

        if (insertError) {
          console.error(`Failed to schedule ${retry.job_type}:`, insertError);
          failedJobs.push(`${retry.job_type}: ${insertError.message}`);
        } else {
          console.log(`Scheduled ${retry.job_type} for: ${retry.run_at.toISOString()}`);
          
          await supabase.from("booking_events").insert({
            booking_id: booking_id,
            event_type: "balance_payment_retry_scheduled",
            channel: "system",
            metadata: {
              job_type: retry.job_type,
              type: "long_notice",
              scheduled_for: retry.run_at.toISOString(),
            },
          });
        }
      }

      // CM2-04: re-issue at T-3 / T-1. The first send (T-15) is unchanged.
      const longReissue = planBalanceReissue({
        eventAnchorMs: eventDateObj.getTime(),
        eventStartMs: orlandoLocalToUTC(booking.event_date, booking.start_time || "00:00:00").getTime(),
        nowMs: now.getTime(),
        otherSendsMs: retries.map((r) => r.run_at.getTime()),
      });
      await insertReissueJobs(supabase, booking_id, longReissue, failedJobs);

      responseData.balance_action = "long_notice";
      responseData.balance_retries_scheduled = [
        ...retries.map(r => ({ job_type: r.job_type, run_at: r.run_at.toISOString() })),
        ...longReissue,
      ];
      responseData.days_until_event = diffDays;
    }

    await reportFailedJobs(supabase, booking, failedJobs, responseData);
    return new Response(JSON.stringify(responseData), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: unknown) {
    console.error("Error in schedule-balance-payment:", error);
    const errorMessage = error instanceof Error ? error.message : "Internal server error";
    
    // Get booking info for alert if possible
    try {
      const body = await req.clone().json().catch(() => ({}));
      if (body.booking_id) {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const supabase = createClient(supabaseUrl, supabaseServiceKey);
        
        const { data: booking } = await supabase
          .from("bookings")
          .select("reservation_number")
          .eq("id", body.booking_id)
          .single();
        
        if (booking) {
          const err = error instanceof Error ? error : new Error(errorMessage);
          await sendCriticalAlert("schedule-balance-payment", booking.reservation_number || body.booking_id, errorMessage, body.booking_id);
          await logCriticalError(supabase, body.booking_id, "schedule-balance-payment", err);
        }
      }
    } catch (alertErr) {
      console.error("Error sending failure alert:", alertErr);
    }
    
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}));
