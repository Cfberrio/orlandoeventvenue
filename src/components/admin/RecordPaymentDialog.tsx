import { useEffect, useState } from "react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { syncToGHL } from "@/hooks/useAdminData";
import {
  PAYMENT_METHOD_LABELS,
  type PaymentKind,
  type PaymentMethod,
  recordablePaymentKinds,
  expectedPaymentAmount,
  validateRecordPayment,
} from "@/lib/recordPayment";

interface RecordPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  booking: {
    id: string;
    deposit_amount: number | string | null;
    balance_amount: number | string | null;
    deposit_paid_at: string | null;
    balance_paid_at: string | null;
  };
  onRecorded: () => void;
}

const KIND_LABELS: Record<PaymentKind, string> = {
  deposit: "Deposit",
  balance: "Balance",
  full: "Full amount (deposit + balance)",
};

// M-7 / M-8 (ClickUp 86e40ach2): record a payment made outside Stripe.
// The server (admin_record_payment) re-checks every rule; this form only
// prefills the exact amount owed and catches obvious mistakes early.
export function RecordPaymentDialog({ open, onOpenChange, booking, onRecorded }: RecordPaymentDialogProps) {
  const { toast } = useToast();
  const kinds = recordablePaymentKinds(booking);
  const [kind, setKind] = useState<PaymentKind | "">(kinds[0] ?? "");
  const [method, setMethod] = useState<PaymentMethod | "">("");
  const [reference, setReference] = useState("");
  const [paidOn, setPaidOn] = useState(format(new Date(), "yyyy-MM-dd"));
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setKind(recordablePaymentKinds(booking)[0] ?? "");
      setMethod("");
      setReference("");
      setPaidOn(format(new Date(), "yyyy-MM-dd"));
      setNote("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, booking.id, booking.deposit_paid_at, booking.balance_paid_at]);

  const amount = kind ? expectedPaymentAmount(booking, kind) : 0;
  const problem = validateRecordPayment({ kind, method, reference, paidOn, today: format(new Date(), "yyyy-MM-dd") });

  const handleSubmit = async () => {
    if (problem || !kind || !method || saving) return;
    setSaving(true);
    try {
      // Noon local time on the chosen day keeps the date stable across time zones.
      const paidAt = new Date(`${paidOn}T12:00:00`).toISOString();
      const { error } = await supabase.rpc("admin_record_payment" as never, {
        p_booking_id: booking.id,
        p_kind: kind,
        p_amount: amount,
        p_method: method,
        p_reference: reference.trim() || null,
        p_paid_at: paidAt,
        p_note: note.trim() || null,
      } as never);
      if (error) throw error;
      toast({ title: `${KIND_LABELS[kind]} of $${amount.toFixed(2)} recorded (${PAYMENT_METHOD_LABELS[method]})` });
      onOpenChange(false);
      onRecorded();
      // Keep the CRM in step with the new payment status (fire and forget;
      // a GHL failure must not undo a recorded payment).
      void syncToGHL(booking.id);
    } catch (error) {
      const message = (error as { message?: string })?.message ?? String(error);
      toast({ title: "Payment not recorded", description: message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
          <DialogDescription>
            For money received outside Stripe (cash, Zelle, check, another card terminal). Stripe payments are
            recorded automatically; do not use this for them.
          </DialogDescription>
        </DialogHeader>

        {kinds.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">Nothing left to record: this booking is fully paid.</p>
        ) : (
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>What was paid</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as PaymentKind)}>
                <SelectTrigger><SelectValue placeholder="Choose" /></SelectTrigger>
                <SelectContent>
                  {kinds.map((k) => (
                    <SelectItem key={k} value={k}>{KIND_LABELS[k]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between rounded border p-3">
              <span className="text-sm text-muted-foreground">Amount (must match what is owed)</span>
              <span className="font-semibold">${amount.toFixed(2)}</span>
            </div>

            <div className="space-y-2">
              <Label>Method</Label>
              <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
                <SelectTrigger><SelectValue placeholder="Choose" /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((m) => (
                    <SelectItem key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="rp-ref">Reference {method && method !== "cash" ? "(required)" : "(optional)"}</Label>
              <Input
                id="rp-ref"
                placeholder="Zelle confirmation, check #, receipt #"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="rp-date">Date received</Label>
              <Input id="rp-date" type="date" value={paidOn} max={format(new Date(), "yyyy-MM-dd")} onChange={(e) => setPaidOn(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="rp-note">Note (optional)</Label>
              <Textarea id="rp-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>

            {problem && <p className="text-xs text-destructive">{problem}</p>}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          {kinds.length > 0 && (
            <Button onClick={handleSubmit} disabled={!!problem || saving}>
              {saving ? "Recording..." : "Record payment"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
