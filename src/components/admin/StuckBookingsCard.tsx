import { useState } from "react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

interface StuckRow {
  booking_id: string;
  reservation_number: string | null;
  full_name: string | null;
  event_date: string | null;
  lifecycle_status: string;
  booking_origin: string | null;
  reason: "start_passed" | "end_plus_24h_passed" | string;
  overdue_since: string;
}

interface UnconfirmedRow {
  booking_id: string;
  reservation_number: string | null;
  full_name: string | null;
  event_date: string | null;
  deposit_paid_at: string;
  hours_waiting: number;
}

// RPCs from migration 20261119150000 (not in the generated types yet).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = supabase.rpc as any;

const REASON_LABEL: Record<string, string> = {
  start_passed: "Start passed, never moved to In Progress",
  end_plus_24h_passed: "Ended over 24h ago, still In Progress",
};

/**
 * L2-10 / CM2-16 / L2-07 (ClickUp 86e40ach2): bookings the lifecycle cron did
 * not move, and paid deposits still waiting for the office after 20h. A stuck
 * past event can be closed with no guest or GHL messages, with a reason.
 */
export default function StuckBookingsCard() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [closing, setClosing] = useState<StuckRow | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const stuck = useQuery({
    queryKey: ["admin-stuck-bookings"],
    queryFn: async () => {
      const { data, error } = await rpc("admin_stuck_bookings");
      if (error) throw error;
      return (data ?? []) as StuckRow[];
    },
    refetchInterval: 5 * 60 * 1000,
  });

  const unconfirmed = useQuery({
    queryKey: ["admin-deposit-unconfirmed"],
    queryFn: async () => {
      const { data, error } = await rpc("admin_deposit_unconfirmed", { p_hours: 20 });
      if (error) throw error;
      return (data ?? []) as UnconfirmedRow[];
    },
    refetchInterval: 5 * 60 * 1000,
  });

  const closeSilently = async () => {
    if (!closing || !reason.trim()) return;
    setBusy(true);
    const { error } = await rpc("admin_close_event_silently", {
      p_booking_id: closing.booking_id,
      p_reason: reason.trim(),
    });
    setBusy(false);
    if (error) {
      toast({ title: "Could not close the event", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Event closed", description: `${closing.reservation_number ?? "Booking"} is now Post-Event. No messages were sent.` });
    setClosing(null);
    setReason("");
    qc.invalidateQueries({ queryKey: ["admin-stuck-bookings"] });
    qc.invalidateQueries({ queryKey: ["bookings"] });
  };

  const loadError = stuck.error ?? unconfirmed.error;
  if (loadError) {
    return (
      <Card className="border-destructive">
        <CardContent className="pt-6 text-sm text-destructive">
          Could not load stuck bookings: {loadError instanceof Error ? loadError.message : String(loadError)}
        </CardContent>
      </Card>
    );
  }

  const stuckRows = stuck.data ?? [];
  const waitingRows = unconfirmed.data ?? [];
  if (stuckRows.length === 0 && waitingRows.length === 0) return null;

  return (
    <>
      <Card className="border-amber-400">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Needs attention</CardTitle>
          <p className="text-sm text-muted-foreground">
            These will not fix themselves. Open the booking, or close a past event without messages.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {stuckRows.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Stuck status ({stuckRows.length})</p>
              {stuckRows.map((r) => (
                <div
                  key={`${r.booking_id}-${r.reason}`}
                  className="flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm"
                >
                  <Link to={`/admin/bookings/${r.booking_id}`} className="font-medium hover:underline">
                    {r.reservation_number ?? "Booking without number"}
                  </Link>
                  <Badge variant="outline">{r.lifecycle_status.replace(/_/g, " ")}</Badge>
                  {r.booking_origin && <Badge variant="secondary">{r.booking_origin}</Badge>}
                  <span className="text-muted-foreground">{REASON_LABEL[r.reason] ?? r.reason}</span>
                  <span className="text-xs text-muted-foreground">
                    since {format(new Date(r.overdue_since), "MM/dd h:mm a")}
                  </span>
                  <Button size="sm" variant="outline" className="ml-auto" onClick={() => setClosing(r)}>
                    Close without messages…
                  </Button>
                </div>
              ))}
            </div>
          )}
          {waitingRows.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">
                Deposit paid, still Pending after 20h ({waitingRows.length})
              </p>
              <p className="text-xs text-muted-foreground">
                The deposit email tells the guest to expect a confirmation within about 24 hours.
              </p>
              {waitingRows.map((r) => (
                <Link
                  key={r.booking_id}
                  to={`/admin/bookings/${r.booking_id}`}
                  className="flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm hover:bg-muted/50"
                >
                  <span className="font-medium">{r.reservation_number ?? "Booking"}</span>
                  {r.event_date && (
                    <span className="text-muted-foreground">
                      event {format(new Date(r.event_date + "T00:00:00"), "MM/dd/yyyy")}
                    </span>
                  )}
                  <Badge className="ml-auto bg-amber-100 text-amber-900 border-amber-300">
                    waiting {Math.round(Number(r.hours_waiting))}h
                  </Badge>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={closing !== null} onOpenChange={(o) => { if (!o) { setClosing(null); setReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Close {closing?.reservation_number ?? "this event"} without messages</DialogTitle>
            <DialogDescription>
              Moves the booking to Post-Event. No guest email, no GHL workflow, no automation runs, and its
              pending event reminders are cancelled. Accepted staff are marked completed. Use this only for a
              past event that should have closed on its own.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this closed by hand? (required)"
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setClosing(null); setReason(""); }} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={closeSilently} disabled={busy || !reason.trim()}>
              {busy ? "Closing…" : "Close event"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
