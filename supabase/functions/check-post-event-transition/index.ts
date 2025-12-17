import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log('Checking for bookings ready to transition to post_event...');

    // Get all bookings that are in_progress
    const { data: bookings, error: fetchError } = await supabase
      .from('bookings')
      .select('id, reservation_number, event_date, start_time, end_time, booking_type, lifecycle_status')
      .eq('lifecycle_status', 'in_progress');

    if (fetchError) {
      console.error('Error fetching bookings:', fetchError);
      throw fetchError;
    }

    if (!bookings || bookings.length === 0) {
      console.log('No bookings in in_progress status');
      return new Response(JSON.stringify({ 
        success: true, 
        message: 'No bookings to check',
        transitioned: 0 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Found ${bookings.length} bookings in in_progress status`);

    const now = new Date();
    const transitionedBookings: string[] = [];
    const pendingHostReport: string[] = [];
    const pendingTime: string[] = [];

    for (const booking of bookings) {
      // Check if host report is completed
      const { data: hostReport } = await supabase
        .from('booking_host_reports')
        .select('id, status')
        .eq('booking_id', booking.id)
        .eq('status', 'submitted')
        .maybeSingle();

      const hostReportCompleted = !!hostReport;

      // Calculate event end time + 24 hours
      let eventEndDateTime: Date;
      
      if (booking.booking_type === 'daily' || !booking.end_time) {
        // Daily booking: use event_date at 23:59:59
        eventEndDateTime = new Date(`${booking.event_date}T23:59:59`);
      } else {
        // Hourly booking: use event_date + end_time
        eventEndDateTime = new Date(`${booking.event_date}T${booking.end_time}`);
      }

      // Add 24 hours
      const eventEndPlus24h = new Date(eventEndDateTime.getTime() + 24 * 60 * 60 * 1000);
      const has24hPassed = now >= eventEndPlus24h;

      console.log(`Booking ${booking.reservation_number}: hostReportCompleted=${hostReportCompleted}, has24hPassed=${has24hPassed}, eventEndPlus24h=${eventEndPlus24h.toISOString()}`);

      // Check both conditions
      if (hostReportCompleted && has24hPassed) {
        console.log(`Transitioning booking ${booking.reservation_number} to post_event`);

        // Update lifecycle_status to post_event
        const { error: updateError } = await supabase
          .from('bookings')
          .update({ 
            lifecycle_status: 'post_event',
            updated_at: new Date().toISOString()
          })
          .eq('id', booking.id);

        if (updateError) {
          console.error(`Error updating booking ${booking.reservation_number}:`, updateError);
          continue;
        }

        // Log the event
        await supabase.from('booking_events').insert({
          booking_id: booking.id,
          event_type: 'auto_lifecycle_post_event',
          channel: 'system',
          metadata: {
            previous_status: 'in_progress',
            new_status: 'post_event',
            reason: 'host_report_completed_and_24h_passed',
            triggered_at: now.toISOString()
          }
        });

        // Sync to GHL
        try {
          await supabase.functions.invoke('sync-to-ghl', {
            body: { booking_id: booking.id }
          });
          console.log(`Synced booking ${booking.reservation_number} to GHL`);
        } catch (syncError) {
          console.error(`Error syncing to GHL for ${booking.reservation_number}:`, syncError);
        }

        transitionedBookings.push(booking.reservation_number);
      } else if (!hostReportCompleted) {
        pendingHostReport.push(booking.reservation_number);
      } else if (!has24hPassed) {
        pendingTime.push(booking.reservation_number);
      }
    }

    const result = {
      success: true,
      checked: bookings.length,
      transitioned: transitionedBookings.length,
      transitioned_bookings: transitionedBookings,
      pending_host_report: pendingHostReport,
      pending_24h: pendingTime
    };

    console.log('Check complete:', result);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in check-post-event-transition:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
