import { useState } from "react";
import { format } from "date-fns";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { syncToGHL } from "@/hooks/useAdminData";

interface Props {
  booking: { id: string; lifecycle_status: string; status: string };
}

const OPEN_STATES = ["confirmed", "pre_event_ready", "in_progress"];

// M-23 / Luis D7 (ClickUp 86e40ach2): events close on their own 24h after
// they end (no guest report needed); the office can close one sooner.
export function EventCloseCard({ booking }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [closing, setClosing] = useState(false);
  const relevant = OPEN_STATES.includes(booking.lifecycle_status) && booking.status !== "cancelled";

  const { data: eta } = useQuery({
    queryKey: ["booking-close-eta", booking.id],
    enabled: relevant,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_booking_close_eta" as never, { p_booking_id: booking.id } as never);
      if (error) throw error;
      return data as unknown as { event_start_at: string; event_end_at: string; auto_close_at: string };
    },
  });

  if (!relevant || !eta) return null;
  const started = new Date(eta.event_start_at) <= new Date();
  if (!started) return null;

  const close = async () => {
    if (closing) return;
    setClosing(true);
    try {
      const { error } = await supabase.rpc("admin_close_event" as never, { p_booking_id: booking.id } as never);
      if (error) throw error;
      toast({ title: "Event closed", description: "Moved to Post Event; staff who accepted are marked completed once the event has ended." });
      void syncToGHL(booking.id);
      queryClient.invalidateQueries();
    } catch (error) {
      toast({ title: "Could not close the event", description: (error as { message?: string })?.message ?? String(error), variant: "destructive" });
    } finally {
      setClosing(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
      <span className="text-muted-foreground">
        Closes automatically {format(new Date(eta.auto_close_at), "MM/dd/yyyy h:mm a")} (24h after the event ends).
      </span>
      <Button size="sm" variant="outline" onClick={close} disabled={closing}>
        {closing ? "Closing..." : "Close event now"}
      </Button>
    </div>
  );
}
