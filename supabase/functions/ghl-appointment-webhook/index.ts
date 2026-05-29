import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-ghl-signature',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify webhook secret
    const webhookSecret = Deno.env.get("GHL_WEBHOOK_SECRET");
    const providedSecret = req.headers.get("x-ghl-signature") || req.headers.get("authorization")?.replace("Bearer ", "");
    
    if (webhookSecret && providedSecret !== webhookSecret) {
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
    console.log("[WEBHOOK] Received event:", payload.type || payload.event_type);

    // Extract event type
    const eventType = payload.type || payload.event_type || "";
    
    // Handle different event types
    if (eventType.includes("appointment.create") || eventType.includes("AppointmentCreate")) {
      await handleAppointmentCreate(supabase, payload);
    } else if (eventType.includes("appointment.update") || eventType.includes("AppointmentUpdate")) {
      await handleAppointmentUpdate(supabase, payload);
    } else if (eventType.includes("appointment.delete") || eventType.includes("AppointmentDelete")) {
      await handleAppointmentDelete(supabase, payload);
    } else {
      console.log("[WEBHOOK] Unhandled event type:", eventType);
    }

    return new Response(
      JSON.stringify({ ok: true, event_type: eventType }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error("[WEBHOOK] Error:", err);
    return new Response(
      JSON.stringify({ ok: false, error: String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function handleAppointmentCreate(supabase: any, payload: any) {
  const appointment = payload.appointment || payload;
  const appointmentId = appointment.id || appointment.appointmentId;
  
  console.log(`[WEBHOOK] Creating booking for appointment: ${appointmentId}`);
  
  // Parse times
  const startTime = new Date(appointment.startTime);
  const endTime = new Date(appointment.endTime);
  const eventDate = startTime.toISOString().split('T')[0];
  const startTimeStr = startTime.toTimeString().slice(0, 5); // HH:MM
  const endTimeStr = endTime.toTimeString().slice(0, 5); // HH:MM
  
  // Infer booking type from duration
  const durationHours = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60);
  const bookingType = durationHours >= 18 ? 'daily' : 'hourly';
  
  // Extract contact info
  const contact = appointment.contact || {};
  const fullName = contact.name || contact.firstName + ' ' + contact.lastName || 'External Booking';
  const email = contact.email || '';
  const phone = contact.phone || contact.phoneNumber || '';
  
  // Check if appointment already exists
  const { data: existing } = await supabase
    .from('bookings')
    .select('id')
    .eq('ghl_appointment_id', appointmentId)
    .single();
  
  if (existing) {
    console.log(`[WEBHOOK] Appointment ${appointmentId} already exists in DB`);
    return;
  }
  
  // Generate reservation number
  const reservationNumber = `EXT-${Date.now().toString().slice(-8)}`;
  
  // Insert new booking
  const { data, error } = await supabase
    .from('bookings')
    .insert({
      reservation_number: reservationNumber,
      ghl_appointment_id: appointmentId,
      ghl_calendar_id: appointment.calendarId,
      event_date: eventDate,
      start_time: startTimeStr,
      end_time: endTimeStr,
      booking_type: bookingType,
      full_name: fullName,
      email: email,
      phone: phone,
      status: appointment.status === 'cancelled' ? 'cancelled' : 'confirmed',
      source: 'google_calendar',
      event_type: appointment.title || 'External Event',
      total_guests: 50, // Default
      total_amount: 0, // External bookings don't have payment
      deposit_amount: 0,
      balance_amount: 0,
      payment_status: 'not_required'
    });
  
  if (error) {
    console.error("[WEBHOOK] Error creating booking:", error);
    throw error;
  }
  
  console.log(`[WEBHOOK] ✅ Created booking ${reservationNumber} for appointment ${appointmentId}`);
}

async function handleAppointmentUpdate(supabase: any, payload: any) {
  const appointment = payload.appointment || payload;
  const appointmentId = appointment.id || appointment.appointmentId;
  
  console.log(`[WEBHOOK] Updating booking for appointment: ${appointmentId}`);
  
  // Check if booking exists
  const { data: existing } = await supabase
    .from('bookings')
    .select('id, source')
    .eq('ghl_appointment_id', appointmentId)
    .single();
  
  if (!existing) {
    console.log(`[WEBHOOK] Appointment ${appointmentId} not found in DB, creating...`);
    await handleAppointmentCreate(supabase, payload);
    return;
  }
  
  // Don't update website bookings (they update via sync-ghl-calendar)
  if (existing.source === 'website') {
    console.log(`[WEBHOOK] Skipping update for website booking`);
    return;
  }
  
  // Parse times
  const startTime = new Date(appointment.startTime);
  const endTime = new Date(appointment.endTime);
  const eventDate = startTime.toISOString().split('T')[0];
  const startTimeStr = startTime.toTimeString().slice(0, 5);
  const endTimeStr = endTime.toTimeString().slice(0, 5);
  
  // Update booking
  const { error } = await supabase
    .from('bookings')
    .update({
      event_date: eventDate,
      start_time: startTimeStr,
      end_time: endTimeStr,
      status: appointment.status === 'cancelled' ? 'cancelled' : 'confirmed',
      event_type: appointment.title || 'External Event'
    })
    .eq('id', existing.id);
  
  if (error) {
    console.error("[WEBHOOK] Error updating booking:", error);
    throw error;
  }
  
  console.log(`[WEBHOOK] ✅ Updated booking for appointment ${appointmentId}`);
}

async function handleAppointmentDelete(supabase: any, payload: any) {
  const appointment = payload.appointment || payload;
  const appointmentId = appointment.id || appointment.appointmentId;
  
  console.log(`[WEBHOOK] Deleting booking for appointment: ${appointmentId}`);
  
  // Mark as cancelled instead of deleting
  const { error } = await supabase
    .from('bookings')
    .update({ status: 'cancelled' })
    .eq('ghl_appointment_id', appointmentId);
  
  if (error) {
    console.error("[WEBHOOK] Error deleting booking:", error);
    throw error;
  }
  
  console.log(`[WEBHOOK] ✅ Cancelled booking for appointment ${appointmentId}`);
}
