// E-8 / E-9 (86e40ach2): void / mark paid offline / resend an invoice.
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  manageInvoice,
  OFFLINE_METHOD_OPTIONS,
  validateInvoiceAction,
  type InvoiceAction,
  type InvoiceKind,
} from "@/lib/manageInvoice";

export interface InvoiceActionTarget {
  action: InvoiceAction;
  kind: InvoiceKind;
  id: string;
  label: string;
  amount: number;
  recurringParent?: boolean;
}

const TITLES: Record<InvoiceAction, string> = {
  void: "Void invoice",
  mark_paid: "Mark paid (offline)",
  resend: "Resend invoice",
};

export default function InvoiceActionDialog({
  target,
  onClose,
  onDone,
}: {
  target: InvoiceActionTarget | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const [method, setMethod] = useState("");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setReason("");
    setMethod("");
    setReference("");
  };

  const submit = async () => {
    if (!target) return;
    const payload = { action: target.action, kind: target.kind, id: target.id, reason, method, reference };
    const problem = validateInvoiceAction(payload);
    if (problem) {
      toast({ title: problem, variant: "destructive" });
      return;
    }
    setBusy(true);
    const res = await manageInvoice(supabase, payload);
    setBusy(false);
    if (!res.ok) {
      toast({ title: `${TITLES[target.action]} failed`, description: res.error, variant: "destructive" });
      return;
    }
    toast({
      title:
        target.action === "void"
          ? `${target.label} voided${res.recurring_stopped ? "; recurring stopped" : ""}`
          : target.action === "mark_paid"
            ? `${target.label} marked paid`
            : res.email_sent
              ? `${target.label} resent`
              : `${target.label}: new link created, but the email did not send. Copy the link and send it.`,
      variant: target.action === "resend" && !res.email_sent ? "destructive" : undefined,
    });
    reset();
    onDone();
    onClose();
  };

  return (
    <Dialog
      open={!!target}
      onOpenChange={(open) => {
        if (!open) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent>
        {target && (
          <>
            <DialogHeader>
              <DialogTitle>{TITLES[target.action]}</DialogTitle>
              <DialogDescription>
                {target.label} · ${target.amount.toFixed(2)}
                {target.action === "void" &&
                  " — the payment link is closed first, so the customer can no longer pay it."}
                {target.action === "mark_paid" && " — the payment link is closed so it cannot be paid twice."}
                {target.action === "resend" && " — the old link is closed and a new one is emailed to the customer."}
              </DialogDescription>
            </DialogHeader>
            {target.action === "void" && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Reason *</label>
                <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Duplicate, customer cancelled, wrong amount…" />
                {target.recurringParent && (
                  <p className="text-xs text-amber-700">This is a recurring invoice: voiding it also stops future invoices.</p>
                )}
              </div>
            )}
            {target.action === "mark_paid" && (
              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium">Paid by *</label>
                  <Select value={method} onValueChange={setMethod}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose method" />
                    </SelectTrigger>
                    <SelectContent>
                      {OFFLINE_METHOD_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium">Reference *</label>
                  <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Zelle confirmation, check #, receipt" />
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button variant={target.action === "void" ? "destructive" : "default"} onClick={submit} disabled={busy}>
                {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {TITLES[target.action]}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
