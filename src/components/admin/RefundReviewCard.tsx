import { useEffect, useState } from "react";
import { format } from "date-fns";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { syncToGHL } from "@/hooks/useAdminData";
import {
  type CollectedBreakdown,
  parseMoney,
  REFUND_DECISION_LABELS,
  REFUND_METHOD_LABELS,
  type RefundDecision,
  refundDecisionFor,
  type RefundMethod,
  toCollected,
  validateRefundDecision,
} from "@/lib/refundDecision";

interface RefundReviewCardProps {
  booking: {
    id: string;
    status: string;
    lifecycle_status: string;
    payment_status: string;
  };
}

interface RecordedDecision {
  decision: RefundDecision;
  refund_amount: number;
  kept_amount: number;
  method?: RefundMethod | null;
  reference?: string | null;
  note?: string | null;
  recorded_by_email?: string | null;
  recorded_at?: string | null;
}

// M-9 (ClickUp 86e40ach2): a cancelled booking that collected money must end
// with a recorded decision (refunded in full, in part, or kept with a reason).
// The refund itself is issued in Stripe (or by cash/Zelle/check); this records it.
export function RefundReviewCard({ booking }: RefundReviewCardProps) {
  const cancelled = booking.status === "cancelled" || booking.lifecycle_status === "cancelled";
  const [open, setOpen] = useState(false);

  const { data: collected } = useQuery({
    queryKey: ["booking-collected", booking.id],
    enabled: cancelled,
    queryFn: async (): Promise<CollectedBreakdown> => {
      const { data, error } = await supabase.rpc("admin_booking_collected" as never, { p_booking_id: booking.id } as never);
      if (error) throw error;
      return toCollected(data);
    },
  });

  const { data: decision } = useQuery({
    queryKey: ["booking-refund-decision", booking.id],
    enabled: cancelled,
    queryFn: async (): Promise<RecordedDecision | null> => {
      const { data, error } = await supabase
        .from("booking_events")
        .select("metadata, created_at")
        .eq("booking_id", booking.id)
        .eq("event_type", "refund_decision_recorded")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data?.metadata as unknown as RecordedDecision | undefined) ?? null;
    },
  });

  if (!cancelled || !collected) return null;

  if (decision) {
    return (
      <Card className="border-muted">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Refund decision</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-1">
          <p className="font-medium">{REFUND_DECISION_LABELS[decision.decision] ?? decision.decision}</p>
          <p>
            Refunded ${Number(decision.refund_amount).toFixed(2)}
            {decision.method ? ` by ${REFUND_METHOD_LABELS[decision.method] ?? decision.method}` : ""}
            {decision.reference ? ` (ref ${decision.reference})` : ""} · kept ${Number(decision.kept_amount).toFixed(2)}
          </p>
          {decision.note && <p className="text-muted-foreground">Reason: {decision.note}</p>}
          {decision.recorded_at && (
            <p className="text-xs text-muted-foreground">
              Recorded {format(new Date(decision.recorded_at), "MM/dd/yyyy h:mm a")}
              {decision.recorded_by_email ? ` by ${decision.recorded_by_email}` : ""}
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  if (collected.total <= 0 || booking.payment_status === "refunded") return null;

  return (
    <>
      <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/20">
        <CardHeader className="pb-2">
          <CardTitle className="text-base text-amber-900 dark:text-amber-200">
            Cancelled with ${collected.total.toFixed(2)} collected
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-3">
          <ul className="text-amber-900 dark:text-amber-200 space-y-0.5">
            {collected.deposit > 0 && <li>Deposit: ${collected.deposit.toFixed(2)}</li>}
            {collected.balance > 0 && <li>Balance: ${collected.balance.toFixed(2)}</li>}
            {collected.addons > 0 && <li>Add-ons: ${collected.addons.toFixed(2)}</li>}
          </ul>
          <p className="text-amber-900 dark:text-amber-200">
            Issue any refund in Stripe (or by cash/Zelle/check), then record what was decided here.
          </p>
          <Button size="sm" onClick={() => setOpen(true)}>Record refund decision</Button>
        </CardContent>
      </Card>
      <RefundDecisionDialog open={open} onOpenChange={setOpen} bookingId={booking.id} collected={collected} />
    </>
  );
}

function RefundDecisionDialog({
  open,
  onOpenChange,
  bookingId,
  collected,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bookingId: string;
  collected: CollectedBreakdown;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [amountText, setAmountText] = useState(collected.total.toFixed(2));
  const [method, setMethod] = useState<RefundMethod | "">("stripe");
  const [reference, setReference] = useState("");
  const [refundedOn, setRefundedOn] = useState(format(new Date(), "yyyy-MM-dd"));
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setAmountText(collected.total.toFixed(2));
      setMethod("stripe");
      setReference("");
      setRefundedOn(format(new Date(), "yyyy-MM-dd"));
      setNote("");
    }
  }, [open, collected.total]);

  const amount = parseMoney(amountText);
  const problem = validateRefundDecision({
    amount,
    collected: collected.total,
    method,
    reference,
    note,
    refundedOn,
    today: format(new Date(), "yyyy-MM-dd"),
  });
  const decision = Number.isFinite(amount) ? refundDecisionFor(amount, collected.total) : null;

  const handleSubmit = async () => {
    if (problem || saving) return;
    setSaving(true);
    try {
      const { error } = await supabase.rpc("admin_record_refund_decision" as never, {
        p_booking_id: bookingId,
        p_amount: amount,
        p_method: amount > 0 ? method : null,
        p_reference: reference.trim() || null,
        p_refunded_at: amount > 0 ? new Date(`${refundedOn}T12:00:00`).toISOString() : null,
        p_note: note.trim() || null,
      } as never);
      if (error) throw error;
      toast({ title: `Refund decision recorded: ${decision ? REFUND_DECISION_LABELS[decision] : ""}` });
      onOpenChange(false);
      queryClient.invalidateQueries();
      void syncToGHL(bookingId);
    } catch (error) {
      const message = (error as { message?: string })?.message ?? String(error);
      toast({ title: "Refund decision not recorded", description: message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record refund decision</DialogTitle>
          <DialogDescription>
            ${collected.total.toFixed(2)} was collected. This records what happened to it; it does not move money.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="rf-amount">Amount refunded (0 if nothing)</Label>
            <Input id="rf-amount" inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} />
            {decision && <p className="text-xs text-muted-foreground">{REFUND_DECISION_LABELS[decision]}</p>}
          </div>
          {Number.isFinite(amount) && amount > 0 && (
            <>
              <div className="space-y-2">
                <Label>Refunded by</Label>
                <Select value={method} onValueChange={(v) => setMethod(v as RefundMethod)}>
                  <SelectTrigger><SelectValue placeholder="Choose" /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(REFUND_METHOD_LABELS) as RefundMethod[]).map((m) => (
                      <SelectItem key={m} value={m}>{REFUND_METHOD_LABELS[m]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="rf-ref">Reference {method !== "cash" ? "(required)" : "(optional)"}</Label>
                <Input
                  id="rf-ref"
                  placeholder="Stripe refund id (re_…), Zelle confirmation, check #"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="rf-date">Refund date</Label>
                <Input id="rf-date" type="date" value={refundedOn} max={format(new Date(), "yyyy-MM-dd")} onChange={(e) => setRefundedOn(e.target.value)} />
              </div>
            </>
          )}
          <div className="space-y-2">
            <Label htmlFor="rf-note">
              Reason {decision && decision !== "refunded_in_full" ? "(required: why money is kept)" : "(optional)"}
            </Label>
            <Textarea id="rf-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {problem && <p className="text-xs text-destructive">{problem}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!!problem || saving}>{saving ? "Saving..." : "Record decision"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
