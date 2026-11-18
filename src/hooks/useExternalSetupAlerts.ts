import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  EXTERNAL_SETUP_MARKERS,
  EXTERNAL_SETUP_TRACKED_SINCE,
  automationSucceeded,
  missingExternalSetupSteps,
  type ExternalSetupStep,
  type SetupEvent,
} from "@/lib/externalSetup";

export interface ExternalSetupAlert {
  booking_id: string;
  reservation_number: string | null;
  full_name: string;
  event_date: string;
  missing: ExternalSetupStep[];
}

export function useExternalSetupAlerts() {
  return useQuery({
    queryKey: ["external-setup-alerts"],
    queryFn: async (): Promise<ExternalSetupAlert[]> => {
      const { data: bookings, error } = await supabase
        .from("bookings")
        .select("id, reservation_number, full_name, email, event_date, lifecycle_status")
        .eq("booking_origin", "external")
        .neq("lifecycle_status", "cancelled")
        .gte("created_at", EXTERNAL_SETUP_TRACKED_SINCE);
      if (error) throw error;
      if (!bookings?.length) return [];

      const { data: events, error: eventsError } = await supabase
        .from("booking_events")
        .select("booking_id, event_type, metadata")
        .in("booking_id", bookings.map((b) => b.id))
        .in("event_type", Object.values(EXTERNAL_SETUP_MARKERS));
      if (eventsError) throw eventsError;

      const byBooking = new Map<string, SetupEvent[]>();
      for (const e of events ?? []) {
        const list = byBooking.get(e.booking_id) ?? [];
        list.push({ event_type: e.event_type, metadata: e.metadata });
        byBooking.set(e.booking_id, list);
      }

      return bookings
        .map((b) => ({
          booking_id: b.id,
          reservation_number: b.reservation_number,
          full_name: b.full_name,
          event_date: b.event_date,
          missing: missingExternalSetupSteps(b, byBooking.get(b.id) ?? []),
        }))
        .filter((a) => a.missing.length > 0);
    },
  });
}

/** Marks the GHL snapshot as synced so the Dashboard stops asking to retry it. */
export async function recordExternalGhlSynced(bookingId: string): Promise<void> {
  const { error } = await supabase.from("booking_events").insert({
    booking_id: bookingId,
    event_type: EXTERNAL_SETUP_MARKERS.ghl,
    channel: "admin",
    metadata: {},
  });
  if (error) console.error("Could not record external_ghl_synced:", error);
}

/**
 * Re-runs only the missing steps. All three functions are idempotent
 * (automation dedupes jobs, E01 checks its marker, sync-to-ghl overwrites).
 */
export function useRetryExternalSetup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ bookingId, missing }: { bookingId: string; missing: ExternalSetupStep[] }) => {
      const failed: ExternalSetupStep[] = [];
      for (const step of missing) {
        try {
          if (step === "automation") {
            const { data, error } = await supabase.functions.invoke("trigger-booking-automation", { body: { booking_id: bookingId } });
            const result = (data ?? {}) as { host_report_scheduling?: unknown; guest_feedback_scheduling?: unknown };
            const ok = automationSucceeded({
              host_report_result: result.host_report_scheduling,
              guest_feedback_result: result.guest_feedback_scheduling,
            });
            if (error || !ok) failed.push(step);
          } else if (step === "ghl") {
            const { data, error } = await supabase.functions.invoke("sync-to-ghl", { body: { booking_id: bookingId } });
            if (error || (data as { ok?: boolean } | null)?.ok === false) failed.push(step);
            else await recordExternalGhlSynced(bookingId);
          } else {
            const { data, error } = await supabase.functions.invoke("send-external-booking-confirmation", { body: { booking_id: bookingId } });
            if (error || (data as { ok?: boolean } | null)?.ok === false) failed.push(step);
          }
        } catch {
          failed.push(step);
        }
      }
      return { failed };
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["external-setup-alerts"] });
    },
  });
}
