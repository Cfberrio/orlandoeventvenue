// E-6 (86e40ach2): override or void an assignment's pay, or remove a manual
// adjustment line. The database keeps the override on the assignment, so a
// recalculation does not undo it; paid assignments are refused server-side.
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { validatePayOverride, type PayMode } from "@/lib/payOverride";

interface Props {
  assignmentId: string;
  currentMode: PayMode;
  currentAmount: number | null;
  currentReason: string | null;
  /** The line the modal was opened on. */
  item: { payroll_item_id: string; pay_category: string; amount: number; paid_status: string };
  onDone: () => void;
}

export default function PayOverridePanel({ assignmentId, currentMode, currentAmount, currentReason, item, onDone }: Props) {
  const { toast } = useToast();
  const [mode, setMode] = useState<PayMode>(currentMode);
  const [amount, setAmount] = useState(currentAmount != null ? String(currentAmount) : "");
  const [reason, setReason] = useState(currentReason ?? "");
  const [removeReason, setRemoveReason] = useState("");
  const [busy, setBusy] = useState(false);
  const isAdjustment = item.pay_category === "bonus" || item.pay_category === "deduction";

  const save = async () => {
    const problem = validatePayOverride({ mode, amount, reason });
    if (problem) {
      toast({ title: problem, variant: "destructive" });
      return;
    }
    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)("admin_set_assignment_pay", {
      p_assignment_id: assignmentId,
      p_mode: mode,
      p_amount: mode === "override" ? Number(amount) : null,
      p_reason: mode === "computed" ? null : reason,
    });
    setBusy(false);
    if (error) {
      toast({ title: "Pay not changed", description: error.message, variant: "destructive" });
      return;
    }
    const total = Number((data as { total?: number })?.total ?? 0);
    toast({ title: "Pay updated", description: `This assignment now pays $${total.toFixed(2)} (incl. adjustments).` });
    onDone();
  };

  const removeLine = async () => {
    if (!removeReason.trim()) {
      toast({ title: "Say why the line is removed", variant: "destructive" });
      return;
    }
    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.rpc as any)("admin_remove_payroll_adjustment", {
      p_item_id: item.payroll_item_id,
      p_reason: removeReason,
    });
    setBusy(false);
    if (error) {
      toast({ title: "Line not removed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: `${item.pay_category === "bonus" ? "Bonus" : "Deduction"} removed` });
    onDone();
  };

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="space-y-2">
          <Label>Pay for this assignment</Label>
          <Select value={mode} onValueChange={(v) => setMode(v as PayMode)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="computed">Calculated (hours / role rate)</SelectItem>
              <SelectItem value="override">Agreed amount</SelectItem>
              <SelectItem value="excluded">No pay (void)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {mode === "override" && (
          <div className="space-y-2">
            <Label>Amount ($) *</Label>
            <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
        )}
        {mode !== "computed" && (
          <div className="space-y-2">
            <Label>Reason *</Label>
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Agreed flat fee, did not show, duplicate assignment…" />
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Bonuses and deductions stay as they are. Once the assignment is paid, use a bonus or deduction instead.
        </p>
        <Button onClick={save} disabled={busy}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save pay
        </Button>
      </div>

      {isAdjustment && item.paid_status !== "paid" && (
        <div className="space-y-2 border-t pt-4">
          <Label>
            Remove this {item.pay_category} (${Number(item.amount).toFixed(2)})
          </Label>
          <Input value={removeReason} onChange={(e) => setRemoveReason(e.target.value)} placeholder="Reason" />
          <Button variant="destructive" onClick={removeLine} disabled={busy}>
            Remove line
          </Button>
        </div>
      )}
    </div>
  );
}
