import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import {
  defaultSendDay,
  formatSendDate,
  nextMonthlySend,
  sendDayPhrase,
} from "@/lib/recurringSchedule";
import SendDaySelect from "@/components/admin/SendDaySelect";

export interface RecurringScheduleTarget {
  id: string;
  invoice_number: string;
  title: string;
  recurring_day_of_month: number | null;
  recurring_next_send_at: string | null;
  recurring_last_sent_at: string | null;
}

interface Props {
  invoice: RecurringScheduleTarget | null;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export default function EditRecurringDayDialog({ invoice, onOpenChange, onSuccess }: Props) {
  const { toast } = useToast();
  const [day, setDay] = useState<number>(() => defaultSendDay());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!invoice) return;
    if (invoice.recurring_day_of_month) {
      setDay(invoice.recurring_day_of_month);
    } else if (invoice.recurring_next_send_at) {
      // Legacy 30-day row: start from the day it is currently due.
      setDay(defaultSendDay(new Date(invoice.recurring_next_send_at)));
    } else {
      setDay(defaultSendDay());
    }
  }, [invoice]);

  if (!invoice) return null;

  const lastSent = invoice.recurring_last_sent_at
    ? new Date(invoice.recurring_last_sent_at)
    : null;
  // Preview only; set_recurring_day_of_month computes the stored date.
  const preview = nextMonthlySend(day, lastSent);

  const save = async () => {
    setSaving(true);
    // Not in the generated types until Lovable regenerates them after the migration.
    const client = supabase as unknown as {
      rpc: (
        fn: string,
        args: Record<string, unknown>
      ) => Promise<{ data: unknown; error: { message: string } | null }>;
    };
    const { data, error } = await client.rpc("set_recurring_day_of_month", {
      p_invoice_id: invoice.id,
      p_day: day,
    });
    setSaving(false);

    if (error) {
      toast({
        title: "Could not change the send day",
        description: error.message,
        variant: "destructive",
      });
      return;
    }

    toast({
      title: `${invoice.invoice_number} now goes out on ${sendDayPhrase(day)} of every month`,
      description: `Next invoice: ${formatSendDate(new Date(data as string))} at 3:00 PM ET.`,
    });
    onSuccess();
  };

  return (
    <Dialog open={!!invoice} onOpenChange={(open) => !saving && onOpenChange(open)}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Change send day</DialogTitle>
          <DialogDescription>
            {invoice.title} ({invoice.invoice_number})
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="flex items-center gap-2">
            <Label htmlFor="edit-send-day" className="text-sm text-muted-foreground">
              Send on day
            </Label>
            <SendDaySelect id="edit-send-day" value={day} onChange={setDay} disabled={saving} />
          </div>

          {invoice.recurring_next_send_at && (
            <p className="text-xs text-muted-foreground">
              Currently scheduled: {formatSendDate(new Date(invoice.recurring_next_send_at))} at
              3:00 PM ET.
            </p>
          )}

          <p className="text-sm">
            Next one on <strong>{formatSendDate(preview)}</strong> at 3:00 PM ET, then on{" "}
            {sendDayPhrase(day)} of every month.
          </p>

          <p className="text-xs text-muted-foreground">
            Only future sends change. At most one invoice goes out per calendar month
            {lastSent ? `; the last one went out ${formatSendDate(lastSent)}` : ""}, so moving the
            day never bills the same month twice.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
