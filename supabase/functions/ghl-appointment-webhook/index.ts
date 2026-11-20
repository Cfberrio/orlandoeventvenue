import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { safeEqual } from "../_shared/internal-auth.ts";
import { escapeHtml } from "../_shared/email-layout.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-ghl-signature',
};

// Second pass X2-15 (ClickUp 86e40ach2).
//
// OEV is the source of truth for every booking: website, internal (admin) and
// external (admin) bookings are all created in OEV and pushed TO GHL by
// sync-ghl-calendar. This webhook used to act on GHL's copy:
//   * appointment deleted in GHL -> booking cancelled, paid website bookings
//     included, with no reason and no guest notice;
//   * appointment created in GHL -> a booking insert that always failed
//     (column total_guests and payment_status 'not_required' do not exist);
//   * appointment updated in GHL -> rewrote date/time/status (never ran: every
//     booking has source = website).
// Now it never writes a booking OEV created. A delete or cancel of such an
// appointment is logged on the booking and the office is emailed to decide.
// The create path is removed. Bookings created anywhere else (none exist
// today) keep the old cancel-on-delete behaviour.

const OEV_ORIGINS = new Set(['website', 'internal', 'external']);

interface BookingRow {
  id: string;
  reservation_number: string | null;
  source: string | null;
  booking_origin: string | null;
  status: string | null;
  lifecycle_status: string | null;
  event_date: string | null;
  full_name: string | null;
}

/** True for every booking OEV created (website flow or the admin wizards). */
function isOevCreated(b: Pick<BookingRow, 'source' | 'booking_origin'>): boolean {
  return (b.source ?? 'website') === 'website' || OEV_ORIGINS.has(b.booking_origin ?? '');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify webhook secret (fail closed, constant-time compare).
    const webhookSecret = Deno.env.get("GHL_WEBHOOK_SECRET") ?? "";
    const providedSecret = req.headers.get("x-ghl-signature") || req.headers.get("authorization")?.replace("Bearer ", "") || "";

    if (!webhookSecret || !providedSecret || !safeEqual(providedSecret, webhookSecret)) {
      console.error("[WEBHOOK] Unauthorized request");
      return new Response(
        JSON.stringify({ ok: false, error: "unauthorized" }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const payload = await req.json();
    const eventType = String(payload.type || payload.event_type || "");
    console.log("[WEBHOOK] Received event:", eventType);

    let result: Record<string, unknown> = { action: "ignored" };
    if (eventType.includes("appointment.create") || eventType.includes("AppointmentCreate")) {
      // Bookings are created in OEV, never from GHL.
      result = { action: "ignored", reason: "create_not_supported" };
    } else if (eventType.includes("appointment.update") || eventType.includes("AppointmentUpdate")) {
      result = await handleAppointmentUpdate(supabase, payload);
    } else if (eventType.includes("appointment.delete") || eventType.includes("AppointmentDelete")) {
      result = await handleAppointmentRemoved(supabase, payload, "deleted");
    } else {
      console.log("[WEBHOOK] Unhandled event type:", eventType);
    }

    return new Response(
      JSON.stringify({ ok: true, event_type: eventType, ...result }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error("[WEBHOOK] Error:", err);
    return new Response(
      JSON.stringify({ ok: false, error: "internal_error" }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function appointmentIdOf(payload: any): string {
  const appointment = payload.appointment || payload;
  return String(appointment.id || appointment.appointmentId || "");
}

async function findBooking(supabase: any, appointmentId: string): Promise<BookingRow | null> {
  if (!appointmentId) return null;
  const { data, error } = await supabase
    .from('bookings')
    .select('id, reservation_number, source, booking_origin, status, lifecycle_status, event_date, full_name')
    .eq('ghl_appointment_id', appointmentId)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as BookingRow | null) ?? null;
}

async function handleAppointmentUpdate(supabase: any, payload: any): Promise<Record<string, unknown>> {
  const appointment = payload.appointment || payload;
  const appointmentId = appointmentIdOf(payload);
  const booking = await findBooking(supabase, appointmentId);

  if (!booking) {
    // Never create a booking from GHL.
    return { action: "ignored", reason: "no_matching_booking" };
  }

  if (booking.status === 'cancelled' || booking.lifecycle_status === 'cancelled') {
    return { action: "ignored", reason: "booking_cancelled" };
  }

  // An appointment cancelled in GHL is handled like a delete.
  if (appointment.status === 'cancelled') {
    return await handleAppointmentRemoved(supabase, payload, "cancelled");
  }

  // Date/time changes are made in OEV (Reschedule), which pushes them to GHL.
  // A GHL-side edit is not copied back.
  return { action: "ignored", reason: "oev_is_source_of_truth", booking_id: booking.id };
}

async function handleAppointmentRemoved(
  supabase: any,
  payload: any,
  how: "deleted" | "cancelled",
): Promise<Record<string, unknown>> {
  const appointmentId = appointmentIdOf(payload);
  const booking = await findBooking(supabase, appointmentId);

  if (!booking) {
    return { action: "ignored", reason: "no_matching_booking" };
  }
  if (booking.status === 'cancelled' || booking.lifecycle_status === 'cancelled') {
    return { action: "ignored", reason: "booking_cancelled", booking_id: booking.id };
  }

  if (isOevCreated(booking)) {
    // Do not cancel. Record it and ask the office.
    const { data: prior } = await supabase
      .from('booking_events')
      .select('id')
      .eq('booking_id', booking.id)
      .eq('event_type', 'ghl_appointment_removed_externally')
      .contains('metadata', { appointment_id: appointmentId })
      .limit(1);
    const alreadyLogged = Array.isArray(prior) && prior.length > 0;

    if (!alreadyLogged) {
      const { error: logError } = await supabase.from('booking_events').insert({
        booking_id: booking.id,
        event_type: 'ghl_appointment_removed_externally',
        channel: 'ghl',
        metadata: {
          appointment_id: appointmentId,
          how,
          action: 'booking_not_cancelled',
          received_at: new Date().toISOString(),
        },
      });
      if (logError) {
        console.error("[WEBHOOK] Could not log the removed appointment:", logError);
        throw logError;
      }
      await alertOffice(booking, appointmentId, how);
    }

    console.log(`[WEBHOOK] Appointment ${appointmentId} ${how} in GHL; booking ${booking.reservation_number} left as is`);
    return { action: "logged_not_cancelled", booking_id: booking.id };
  }

  // Not created by OEV (none exist today): keep the old cancel behaviour.
  const { data: cancelled, error } = await supabase
    .from('bookings')
    .update({ status: 'cancelled' })
    .eq('id', booking.id)
    .neq('status', 'cancelled')
    .select('id');
  if (error) {
    console.error("[WEBHOOK] Error cancelling booking:", error);
    throw error;
  }

  for (const row of (cancelled ?? []) as Array<{ id: string }>) {
    try {
      const { data: cleanup, error: cleanupError } = await supabase.functions.invoke('cancel-booking', {
        body: { booking_id: row.id },
      });
      if (cleanupError || cleanup?.ok === false) {
        console.error(`[WEBHOOK] cancel-booking cleanup failed for ${row.id}:`, cleanupError ?? cleanup?.error);
        const { error: logError } = await supabase.from('booking_events').insert({
          booking_id: row.id,
          event_type: 'cancel_cleanup_failed',
          channel: 'ghl',
          metadata: { source: 'ghl_appointment_delete', error: String(cleanupError?.message ?? cleanup?.error ?? 'unknown') },
        });
        if (logError) console.error("[WEBHOOK] Error logging cleanup failure:", logError);
      }
    } catch (cleanupErr) {
      console.error(`[WEBHOOK] cancel-booking cleanup threw for ${row.id}:`, cleanupErr);
    }
  }

  return { action: "cancelled", count: cancelled?.length ?? 0 };
}

async function alertOffice(booking: BookingRow, appointmentId: string, how: "deleted" | "cancelled"): Promise<void> {
  const gmailUser = Deno.env.get("GMAIL_USER");
  const gmailPassword = Deno.env.get("GMAIL_APP_PASSWORD");
  if (!gmailUser || !gmailPassword) {
    console.error("[WEBHOOK] Gmail not configured; office alert not sent");
    return;
  }
  const reservation = booking.reservation_number || booking.id;
  try {
    const client = new SMTPClient({
      connection: {
        hostname: "smtp.gmail.com",
        port: 465,
        tls: true,
        auth: { username: gmailUser, password: gmailPassword },
      },
    });
    const html =
      `<html><body style="font-family:Arial,sans-serif;padding:20px;">` +
      `<h2>GHL appointment ${escapeHtml(how)}</h2>` +
      `<p>The GHL calendar appointment for reservation <b>${escapeHtml(reservation)}</b>` +
      ` (event date ${escapeHtml(booking.event_date ?? "unknown")}) was ${escapeHtml(how)} in GHL.</p>` +
      `<p>The booking was <b>not</b> cancelled in OEV. If the event is really cancelled, cancel it from the booking page in the admin. ` +
      `If the event is still on, the GHL calendar no longer shows it: ask the developer to re-create the appointment.</p>` +
      `<p style="color:#666;font-size:12px;">GHL appointment id: ${escapeHtml(appointmentId)}</p>` +
      `</body></html>`;
    await client.send({
      from: gmailUser,
      to: gmailUser,
      subject: `GHL appointment ${how} for ${reservation} (booking not cancelled)`,
      content: `The GHL appointment for ${reservation} was ${how} in GHL. The booking was not cancelled in OEV.`,
      html,
    });
    await client.close();
  } catch (err) {
    console.error("[WEBHOOK] Office alert failed:", err);
  }
}
