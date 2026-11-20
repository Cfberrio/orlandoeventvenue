// ST2-16 (86e40ach2): staff accept/decline answers were only emailed, never
// shown in the admin. The Dashboard lists the last 7 days of answers.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface StaffResponseEvent {
  id: string;
  booking_id: string;
  response: "accepted" | "rejected";
  staff_name: string;
  role: string;
  recorded_by_office: boolean;
  created_at: string;
  reservation_number: string | null;
  event_date: string | null;
  lifecycle_status: string | null;
}

export const STAFF_RESPONSE_WINDOW_DAYS = 7;

export function useStaffResponseEvents() {
  return useQuery({
    queryKey: ["staff-response-events"],
    queryFn: async (): Promise<StaffResponseEvent[]> => {
      const since = new Date(Date.now() - STAFF_RESPONSE_WINDOW_DAYS * 24 * 3600 * 1000).toISOString();
      const { data, error } = await supabase
        .from("booking_events")
        .select("id, booking_id, event_type, metadata, created_at, bookings(reservation_number, event_date, lifecycle_status)")
        .in("event_type", ["staff_assignment_accepted", "staff_assignment_rejected"])
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []).map((e) => {
        const m = (e.metadata ?? {}) as Record<string, unknown>;
        const b = (e as { bookings?: { reservation_number: string | null; event_date: string | null; lifecycle_status: string | null } | null }).bookings;
        return {
          id: e.id,
          booking_id: e.booking_id,
          response: e.event_type === "staff_assignment_accepted" ? "accepted" : "rejected",
          staff_name: String(m.staff_name ?? "Staff member"),
          role: String(m.assignment_role ?? ""),
          recorded_by_office: m.recorded_by_office === true,
          created_at: e.created_at,
          reservation_number: b?.reservation_number ?? null,
          event_date: b?.event_date ?? null,
          lifecycle_status: b?.lifecycle_status ?? null,
        };
      });
    },
  });
}
