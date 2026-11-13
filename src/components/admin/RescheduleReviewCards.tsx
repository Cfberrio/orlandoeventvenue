import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { syncToGHL } from "@/hooks/useAdminData";
import {
  describeDelta,
  PRICE_DECISION_LABELS,
  type PriceDecision,
  priceDecisionOptions,
  type PriceReviewDetails,
  validatePriceDecision,
} from "@/lib/reschedulePrice";

interface ReviewRow {
  id: string;
  kind: "reschedule_price" | "staff_hours";
  status: string;
  details: Record<string, unknown>;
  created_at: string;
}

interface StaffLine {
  assignment_id: string;
  staff_name?: string | null;
  role?: string | null;
  scheduled_start_time?: string | null;
  scheduled_end_time?: string | null;
  outside_new_window?: boolean;
}

interface Props {
  booking: {
    id: string;
    balance_amount: number | string | null;
    balance_paid_at: string | null;
    balance_link_expires_at?: string | null;
  };
}

// M-1 (ClickUp 86e40ach2): what a reschedule left for the office to decide.
// The price difference is never charged or refunded automatically (Luis D8);
// staff hours are flagged, not changed.
export function RescheduleReviewCards({ booking }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [priceOpen, setPriceOpen] = useState(false);
  const [markingStaff, setMarkingStaff] = useState(false);

  const { data: reviews } = useQuery({
    queryKey: ["booking-reschedule-reviews", booking.id],
    queryFn: async (): Promise<ReviewRow[]> => {
      const { data, error } = await supabase
        .from("booking_money_reviews" as never)
        .select("id, kind, status, details, created_at")
        .eq("booking_id", booking.id)
        .in("kind", ["reschedule_price", "staff_hours"])
        .eq("status", "open")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as ReviewRow[];
    },
  });

  const price = reviews?.find((r) => r.kind === "reschedule_price");
  const staff = reviews?.find((r) => r.kind === "staff_hours");
  if (!price && !staff) return null;

  const markStaffReviewed = async () => {
    if (!staff || markingStaff) return;
    setMarkingStaff(true);
    try {
      const { error } = await supabase.rpc("admin_mark_staff_hours_reviewed" as never, { p_review_id: staff.id } as never);
      if (error) throw error;
      toast({ title: "Staff hours marked as reviewed" });
      queryClient.invalidateQueries({ queryKey: ["booking-reschedule-reviews", booking.id] });
    } catch (error) {
      toast({ title: "Could not save", description: (error as { message?: string })?.message ?? String(error), variant: "destructive" });
    } finally {
      setMarkingStaff(false);
    }
  };

  const staffLines = ((staff?.details.assignments as StaffLine[] | undefined) ?? []);
  const priceDetails = price?.details as unknown as PriceReviewDetails | undefined;

  return (
    <>
      {price && priceDetails && (
        <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-amber-900 dark:text-amber-200">
              Rescheduled: {describeDelta(Number(priceDetails.delta))}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2 text-amber-900 dark:text-amber-200">
            <p>
              Total ${Number(priceDetails.old_total).toFixed(2)} → ${Number(priceDetails.new_total).toFixed(2)}
              {priceDetails.old_hours != null && priceDetails.new_hours != null
                ? ` (${priceDetails.old_hours}h → ${priceDetails.new_hours}h`
                  + (priceDetails.old_package_hours != null && priceDetails.new_package_hours != null
                    ? `, package ${priceDetails.old_package_hours}h → ${priceDetails.new_package_hours}h)`
                    : ")")
                : ""}
            </p>
            <p className="text-xs">
              Priced at the rates this booking was sold at. Nothing was charged or refunded: choose what to do.
            </p>
            <Button size="sm" onClick={() => setPriceOpen(true)}>Decide on the difference</Button>
          </CardContent>
        </Card>
      )}
      {staff && (
        <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-amber-900 dark:text-amber-200">
              Event date/time changed: check staff hours
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2 text-amber-900 dark:text-amber-200">
            <ul className="space-y-0.5">
              {staffLines.map((s) => (
                <li key={s.assignment_id}>
                  {s.staff_name || "Staff"} ({s.role || "role"})
                  {s.scheduled_start_time && s.scheduled_end_time
                    ? ` · hours on file ${s.scheduled_start_time.slice(0, 5)}–${s.scheduled_end_time.slice(0, 5)}`
                    : " · no custom hours"}
                  {s.outside_new_window ? " · outside the new event window" : ""}
                </li>
              ))}
            </ul>
            <p className="text-xs">
              Staff were emailed about the change. Adjust their hours on the Staff tab if needed; pay is calculated
              from those hours when the event is completed.
            </p>
            <Button size="sm" variant="outline" onClick={markStaffReviewed} disabled={markingStaff}>
              {markingStaff ? "Saving..." : "Staff hours reviewed"}
            </Button>
          </CardContent>
        </Card>
      )}
      {price && priceDetails && (
        <PriceDecisionDialog
          open={priceOpen}
          onOpenChange={setPriceOpen}
          reviewId={price.id}
          delta={Number(priceDetails.delta)}
          booking={booking}
        />
      )}
    </>
  );
}

function PriceDecisionDialog({
  open,
  onOpenChange,
  reviewId,
  delta,
  booking,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reviewId: string;
  delta: number;
  booking: Props["booking"];
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [decision, setDecision] = useState<PriceDecision | "">("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const options = priceDecisionOptions(delta, booking);

  useEffect(() => {
    if (open) {
      setDecision("");
      setReference("");
      setNote("");
    }
  }, [open, reviewId]);

  const problem = validatePriceDecision({ decision, reference, note });

  const submit = async () => {
    if (problem || saving || !decision) return;
    setSaving(true);
    try {
      const { error } = await supabase.rpc("admin_resolve_reschedule_price" as never, {
        p_review_id: reviewId,
        p_decision: decision,
        p_reference: reference.trim() || null,
        p_note: note.trim() || null,
      } as never);
      if (error) throw error;
      toast({ title: `Saved: ${PRICE_DECISION_LABELS[decision]}` });
      onOpenChange(false);
      // Totals, balance, revenue and lists can all change.
      queryClient.invalidateQueries();
      if (decision === "apply_to_balance") void syncToGHL((booking as { id: string }).id);
    } catch (error) {
      toast({ title: "Not saved", description: (error as { message?: string })?.message ?? String(error), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{describeDelta(delta)}</DialogTitle>
          <DialogDescription>Choose how to handle the price difference from the reschedule.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {options.map((o) => (
            <label key={o.decision} className={`flex items-start gap-2 rounded border p-2 text-sm ${o.disabledReason ? "opacity-50" : "cursor-pointer"}`}>
              <input
                type="radio"
                name="price-decision"
                className="mt-1"
                disabled={!!o.disabledReason}
                checked={decision === o.decision}
                onChange={() => setDecision(o.decision)}
              />
              <span>
                <span className="font-medium">{PRICE_DECISION_LABELS[o.decision]}</span>
                {o.decision === "apply_to_balance" && !o.disabledReason && (
                  <span className="block text-xs text-muted-foreground">
                    Balance ${Number(booking.balance_amount ?? 0).toFixed(2)} → ${(Number(booking.balance_amount ?? 0) + delta).toFixed(2)}; the next balance link uses the new amount.
                  </span>
                )}
                {o.disabledReason && <span className="block text-xs text-muted-foreground">{o.disabledReason}</span>}
              </span>
            </label>
          ))}
          {(decision === "charged_separately" || decision === "refunded_separately") && (
            <div className="space-y-2">
              <Label htmlFor="pd-ref">Reference (required)</Label>
              <Input
                id="pd-ref"
                placeholder={decision === "charged_separately" ? "Invoice number" : "Stripe refund id, Zelle confirmation, check #"}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="pd-note">Reason {decision === "waived" ? "(required)" : "(optional)"}</Label>
            <Textarea id="pd-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {problem && decision && <p className="text-xs text-destructive">{problem}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={!!problem || saving}>{saving ? "Saving..." : "Save decision"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
