import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, X, RefreshCw } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

export interface InvoiceInitialData {
  title: string;
  description: string | null;
  lineItems: { label: string; amount: number }[];
  customerEmail: string;
  customerName: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  initialData?: InvoiceInitialData | null;
}

interface LineItem {
  label: string;
  amount: string;
}

type FrequencyPreset = "weekly" | "biweekly" | "monthly" | "custom";

const PRESETS: { key: FrequencyPreset; label: string; days: number | null }[] = [
  { key: "weekly", label: "Weekly", days: 7 },
  { key: "biweekly", label: "Bi-weekly", days: 14 },
  { key: "monthly", label: "Monthly", days: 30 },
  { key: "custom", label: "Custom", days: null },
];

function computeNextSendUtc(intervalDays: number): string {
  const now = new Date();
  const orlandoParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => orlandoParts.find((p) => p.type === t)?.value ?? "0";
  const todayOrlando = new Date(
    Date.UTC(+get("year"), +get("month") - 1, +get("day"))
  );
  todayOrlando.setUTCDate(todayOrlando.getUTCDate() + intervalDays);

  // Probe 20:00 UTC on the target date to detect EST vs EDT
  const probe = new Date(Date.UTC(
    todayOrlando.getUTCFullYear(),
    todayOrlando.getUTCMonth(),
    todayOrlando.getUTCDate(),
    20, 0, 0
  ));
  const probeHour = +new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    hour12: false,
  }).format(probe);

  // 20:00 UTC → 15 in EST (offset 5h) or 16 in EDT (offset 4h)
  const utcHour = 15 + (20 - probeHour);

  return new Date(Date.UTC(
    todayOrlando.getUTCFullYear(),
    todayOrlando.getUTCMonth(),
    todayOrlando.getUTCDate(),
    utcHour, 0, 0
  )).toISOString();
}

export default function CreateInvoiceDialog({ open, onOpenChange, onSuccess, initialData }: Props) {
  const { toast } = useToast();
  const { user } = useAuth();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [lineItems, setLineItems] = useState<LineItem[]>([{ label: "", amount: "" }]);
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [loading, setLoading] = useState(false);

  const [isRecurring, setIsRecurring] = useState(false);
  const [frequencyPreset, setFrequencyPreset] = useState<FrequencyPreset>("monthly");
  const [customDays, setCustomDays] = useState("");

  const isDuplicate = !!initialData;

  const intervalDays =
    frequencyPreset === "custom"
      ? parseInt(customDays, 10) || 0
      : PRESETS.find((p) => p.key === frequencyPreset)?.days ?? 0;

  useEffect(() => {
    if (open && initialData) {
      setTitle(initialData.title);
      setDescription(initialData.description ?? "");
      setLineItems(
        initialData.lineItems.length > 0
          ? initialData.lineItems.map((i) => ({ label: i.label, amount: String(i.amount) }))
          : [{ label: "", amount: "" }]
      );
      setCustomerEmail(initialData.customerEmail);
      setCustomerName(initialData.customerName ?? "");
    } else if (open && !initialData) {
      resetForm();
    }
  }, [open, initialData]);

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setLineItems([{ label: "", amount: "" }]);
    setCustomerEmail("");
    setCustomerName("");
    setIsRecurring(false);
    setFrequencyPreset("monthly");
    setCustomDays("");
  };

  const addItem = () => {
    setLineItems([...lineItems, { label: "", amount: "" }]);
  };

  const removeItem = (index: number) => {
    if (lineItems.length <= 1) return;
    setLineItems(lineItems.filter((_, i) => i !== index));
  };

  const updateItem = (index: number, field: keyof LineItem, value: string) => {
    const updated = [...lineItems];
    updated[index] = { ...updated[index], [field]: value };
    setLineItems(updated);
  };

  const total = lineItems.reduce((sum, item) => {
    const val = parseFloat(item.amount);
    return sum + (isNaN(val) ? 0 : val);
  }, 0);

  const PROCESSING_FEE_RATE = 0.035;
  const processingFee = Math.round(total * PROCESSING_FEE_RATE * 100) / 100;
  const totalWithFee = total + processingFee;

  const handleSubmit = async () => {
    if (!title.trim()) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }

    const validItems = lineItems.filter((item) => item.label.trim() && parseFloat(item.amount) > 0);
    if (validItems.length === 0) {
      toast({ title: "Add at least one item with a name and amount", variant: "destructive" });
      return;
    }

    if (total <= 0) {
      toast({ title: "Total must be greater than $0", variant: "destructive" });
      return;
    }

    if (!customerEmail.trim() || !customerEmail.includes("@")) {
      toast({ title: "Enter a valid email address", variant: "destructive" });
      return;
    }

    if (isRecurring && intervalDays < 1) {
      toast({ title: "Recurring frequency must be at least 1 day", variant: "destructive" });
      return;
    }

    setLoading(true);

    try {
      const itemsPayload = validItems.map((item) => ({
        label: item.label.trim(),
        amount: parseFloat(item.amount),
      }));

      const insertPayload: Record<string, unknown> = {
        title: title.trim(),
        description: description.trim() || null,
        amount: total,
        line_items: itemsPayload,
        customer_email: customerEmail.trim().toLowerCase(),
        customer_name: customerName.trim() || null,
        created_by: user?.id || null,
      };

      if (isRecurring) {
        insertPayload.is_recurring = true;
        insertPayload.recurring_interval_days = intervalDays;
        insertPayload.recurring_active = true;
        insertPayload.recurring_next_send_at = computeNextSendUtc(intervalDays);
      }

      const { data: invoice, error: insertError } = await supabase
        .from("invoices" as any)
        .insert(insertPayload)
        .select()
        .single();

      if (insertError) throw insertError;
      const invoiceData = invoice as any;

      const { data: fnResult, error: fnError } = await supabase.functions.invoke(
        "create-invoice",
        {
          body: {
            invoice_id: invoiceData.id,
            customer_email: customerEmail.trim().toLowerCase(),
            customer_name: customerName.trim() || undefined,
          },
        }
      );

      if (fnError) throw fnError;

      const recurringNote = isRecurring
        ? ` Recurring every ${intervalDays} day${intervalDays !== 1 ? "s" : ""}.`
        : "";

      toast({
        title: "Invoice created & sent",
        description: `Payment link emailed to ${customerEmail.trim()}.${recurringNote}`,
      });

      resetForm();
      onSuccess();
    } catch (err: unknown) {
      console.error("Error creating invoice:", err);
      const message = err instanceof Error ? err.message : "Failed to create invoice";
      toast({ title: message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const dialogTitle = isDuplicate
    ? "Duplicate Invoice"
    : isRecurring
    ? "Create Recurring Invoice"
    : "Create New Invoice";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="invoice-title">Invoice Title *</Label>
            <Input
              id="invoice-title"
              placeholder="e.g. Event Services - March 15"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={loading}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="invoice-desc">Notes</Label>
            <Textarea
              id="invoice-desc"
              placeholder="Optional notes for the customer..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={loading}
              rows={2}
            />
          </div>

          <div className="space-y-3">
            <Label>Items *</Label>
            <div className="space-y-2">
              {lineItems.map((item, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input
                    placeholder="Service name"
                    value={item.label}
                    onChange={(e) => updateItem(index, "label", e.target.value)}
                    disabled={loading}
                    className="flex-1"
                  />
                  <div className="relative w-28 shrink-0">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                      $
                    </span>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      value={item.amount}
                      onChange={(e) => updateItem(index, "amount", e.target.value)}
                      disabled={loading}
                      className="pl-7"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeItem(index)}
                    disabled={loading || lineItems.length <= 1}
                    className="shrink-0 h-9 w-9"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addItem}
              disabled={loading}
            >
              <Plus className="h-4 w-4 mr-1" />
              Add Item
            </Button>

            <div className="pt-3 border-t space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Subtotal</span>
                <span className="text-sm">
                  ${total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Processing Fee (3.5%)</span>
                <span className="text-sm">
                  ${processingFee.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Total (client pays)</span>
                <span className="text-lg font-bold">
                  ${totalWithFee.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="invoice-email">Customer Email *</Label>
            <Input
              id="invoice-email"
              type="email"
              placeholder="customer@example.com"
              value={customerEmail}
              onChange={(e) => setCustomerEmail(e.target.value)}
              disabled={loading}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="invoice-name">Customer Name</Label>
            <Input
              id="invoice-name"
              placeholder="Optional"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              disabled={loading}
            />
          </div>

          {/* Recurring invoice section */}
          <div className="border-t pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <RefreshCw className="h-4 w-4 text-muted-foreground" />
                <Label htmlFor="recurring-toggle" className="cursor-pointer">
                  Recurring Invoice
                </Label>
              </div>
              <Switch
                id="recurring-toggle"
                checked={isRecurring}
                onCheckedChange={setIsRecurring}
                disabled={loading}
              />
            </div>

            {isRecurring && (
              <div className="space-y-3 pl-6 border-l-2 border-amber-200">
                <Label className="text-sm text-muted-foreground">
                  How often should this invoice be sent?
                </Label>
                <div className="flex flex-wrap gap-2">
                  {PRESETS.map((preset) => (
                    <Button
                      key={preset.key}
                      type="button"
                      size="sm"
                      variant={frequencyPreset === preset.key ? "default" : "outline"}
                      onClick={() => setFrequencyPreset(preset.key)}
                      disabled={loading}
                    >
                      {preset.label}
                    </Button>
                  ))}
                </div>

                {frequencyPreset === "custom" && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Every</span>
                    <Input
                      type="number"
                      min="1"
                      max="365"
                      placeholder="30"
                      value={customDays}
                      onChange={(e) => setCustomDays(e.target.value)}
                      disabled={loading}
                      className="w-20"
                    />
                    <span className="text-sm text-muted-foreground">days</span>
                  </div>
                )}

                {intervalDays > 0 && (
                  <p className="text-xs text-muted-foreground">
                    First invoice sent now. Next one on{" "}
                    {new Date(computeNextSendUtc(intervalDays)).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}{" "}
                    at 3:00 PM ET, then every {intervalDays} day{intervalDays !== 1 ? "s" : ""}.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isRecurring ? "Create & Send Recurring Invoice" : "Create & Send Invoice"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
