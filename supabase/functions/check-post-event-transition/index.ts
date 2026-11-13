import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Lifecycle cron (every 15 min). ClickUp 86e40ach2, M-23..M-25 + Luis D7:
//   * event started  -> in_progress, whatever the payment state (M-24);
//   * event ended 24h ago -> post_event, without waiting for the guest's
//     report (D7; it almost never arrived and every booking waited 10 days).
// Which bookings are due is decided in SQL (lifecycle_moves_due, Orlando time,
// overnight-aware). Every move goes through transition_booking: row lock,
// allowed transitions, compare-and-set on the state read here, never on a
// cancelled booking (M-25). Safe to run concurrently or twice.

interface DueMove {
  booking_id: string;
  reservation_number: string | null;
  from_lifecycle: string;
  to_lifecycle: string;
  reason: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: due, error: dueError } = await supabase.rpc('lifecycle_moves_due');
    if (dueError) {
      console.error('lifecycle_moves_due failed:', dueError);
      throw dueError;
    }

    const moved: string[] = [];
    const skipped: Array<{ reservation: string | null; reason: string }> = [];
    const failed: Array<{ reservation: string | null; error: string }> = [];

    for (const m of (due ?? []) as DueMove[]) {
      const { data: r, error } = await supabase.rpc('transition_booking', {
        p_booking_id: m.booking_id,
        p_to: m.to_lifecycle,
        p_expected_from: [m.from_lifecycle],
        p_reason: m.reason,
        p_channel: 'system',
      });
      if (error) {
        console.error(`transition_booking failed for ${m.reservation_number}:`, error);
        failed.push({ reservation: m.reservation_number, error: error.message });
        continue;
      }
      const result = r as { ok: boolean; changed?: boolean; reason?: string };
      if (!result?.ok || result.changed === false) {
        skipped.push({ reservation: m.reservation_number, reason: result?.reason ?? 'unchanged' });
        continue;
      }

      moved.push(`${m.reservation_number}:${m.from_lifecycle}->${m.to_lifecycle}`);

      // GHL gets the new lifecycle. The booking is no longer "due" on the next
      // run, so retry here once and leave a visible event if both fail.
      let synced = false;
      let lastSyncError = '';
      for (let attempt = 1; attempt <= 2 && !synced; attempt++) {
        try {
          const { data: syncData, error: syncError } = await supabase.functions.invoke('sync-to-ghl', {
            body: {
              booking_id: m.booking_id,
              sync_reason: m.to_lifecycle === 'post_event' ? 'auto_close_24h' : 'event_started',
            },
          });
          if (syncError || (syncData as { ok?: boolean } | null)?.ok === false) {
            lastSyncError = String(syncError?.message ?? (syncData as { error?: string } | null)?.error ?? 'sync failed');
          } else {
            synced = true;
          }
        } catch (syncErr) {
          lastSyncError = syncErr instanceof Error ? syncErr.message : String(syncErr);
        }
        if (!synced && attempt === 1) await new Promise((r) => setTimeout(r, 2000));
      }
      if (!synced) {
        console.error(`sync-to-ghl failed for ${m.reservation_number}:`, lastSyncError);
        const { error: logError } = await supabase.from('booking_events').insert({
          booking_id: m.booking_id,
          event_type: 'ghl_sync_failed_after_lifecycle',
          channel: 'system',
          metadata: { to_lifecycle: m.to_lifecycle, error: lastSyncError },
        });
        if (logError) console.error('Could not log GHL sync failure:', logError);
      }
    }

    const result = { success: failed.length === 0, due: due?.length ?? 0, moved, skipped, failed };
    console.log('Lifecycle check complete:', JSON.stringify(result));
    return new Response(JSON.stringify(result), {
      status: failed.length === 0 ? 200 : 500,
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
