import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { FunctionsHttpError } from "@supabase/supabase-js";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, X, RefreshCw } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { usePricing } from "@/hooks/usePricing";
import {
  computeDiscountAmount,
  sumBillableItems,
  MIN_INVOICE_NET,
  type DiscountType,
} from "@/lib/invoiceDiscount";
import {
  defaultSendDay,
  formatSendDate,
  nextMonthlySend,
  sendDayPhrase,
} from "@/lib/recurringSchedule";
import SendDaySelect from "@/components/admin/SendDaySelect";

export interface InvoiceInitialData {
  title: string;
  description: string | null;
  lineItems: { label: string; amount: number }[];
  customerEmail: string;
  customerName: string | null;
  discountType: DiscountType | null;
  discountValue: number | null;
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
type FirstSend = "now" | "wait";

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

  const [discountType, setDiscountType] = useState<DiscountType>("percent");
  const [discountValue, setDiscountValue] = useState("");

  const [isRecurring, setIsRecurring] = useState(false);
  const [frequencyPreset, setFrequencyPreset] = useState<FrequencyPreset>("monthly");
  const [customDays, setCustomDays] = useState("");
  const [sendDay, setSendDay] = useState<number>(() => defaultSendDay());
  const [firstSend, setFirstSend] = useState<FirstSend>("now");

  const isDuplicate = !!initialData;

  const intervalDays =
    frequencyPreset === "custom"
      ? parseInt(customDays, 10) || 0
      : PRESETS.find((p) => p.key === frequencyPreset)?.days ?? 0;

  // Monthly = same calendar day every month (recurring_day_of_month), not +30
  // days. Only monthly can wait for its day; the other cadences always send the
  // first invoice now.
  const isMonthly = frequencyPreset === "monthly";
  const sendsNow = !isRecurring || !isMonthly || firstSend === "now";

  const computeFirstScheduledSend = (now: Date): string =>
    isMonthly
      ? nextMonthlySend(sendDay, sendsNow ? now : null, now).toISOString()
      : computeNextSendUtc(intervalDays);

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
      setDiscountType(initialData.discountType ?? "percent");
      setDiscountValue(
        initialData.discountValue != null ? String(initialData.discountValue) : ""
      );
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
    setDiscountType("percent");
    setDiscountValue("");
    setIsRecurring(false);
    setFrequencyPreset("monthly");
    setCustomDays("");
    setSendDay(defaultSendDay());
    setFirstSend("now");
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

  // Only rows that survive into line_items may count toward the subtotal. A row
  // with an amount but no name is dropped from line_items, and since a discounted
  // invoice bills Stripe a single line at `amount`, counting it here would charge
  // the customer for an item that appears nowhere in the invoice.
  const validItems = lineItems.filter(
    (item) => item.label.trim() && parseFloat(item.amount) > 0
  );
  const orphanAmountRows = lineItems.filter(
    (item) => !item.label.trim() && parseFloat(item.amount) > 0
  );

  const subtotal = sumBillableItems(lineItems);

  const parsedDiscountValue = parseFloat(discountValue);
  const hasDiscount = !isNaN(parsedDiscountValue) && parsedDiscountValue > 0;
  const discountAmount = computeDiscountAmount(
    subtotal,
    hasDiscount ? discountType : null,
    hasDiscount ? parsedDiscountValue : null
  );
  // What the customer owes before the processing fee. This is what gets stored
  // in invoices.amount, so Stripe, the fee and the revenue reports all follow it.
  const netAmount = Math.round((subtotal - discountAmount) * 100) / 100;

  const { pricing: pp } = usePricing();
  const PROCESSING_FEE_RATE = (pp.processing_fee || 3.5) / 100;
  const processingFee = Math.round(netAmount * PROCESSING_FEE_RATE * 100) / 100;
  const totalWithFee = netAmount + processingFee;

  const handleSubmit = async () => {
    if (!title.trim()) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }

    if (validItems.length === 0) {
      toast({ title: "Add at least one item with a name and amount", variant: "destructive" });
      return;
    }

    if (orphanAmountRows.length > 0) {
      toast({
        title: "Every item with an amount needs a name",
        description: "Unnamed items are not billed and would be dropped from the invoice.",
        variant: "destructive",
      });
      return;
    }

    if (subtotal <= 0) {
      toast({ title: "Subtotal must be greater than $0", variant: "destructive" });
      return;
    }

    if (netAmount < MIN_INVOICE_NET) {
      toast({
        title: `Total after discount must be at least $${MIN_INVOICE_NET.toFixed(2)}`,
        description: "Stripe cannot charge less than that.",
        variant: "destructive",
      });
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
        subtotal,
        discount_type: discountAmount > 0 ? discountType : null,
        discount_value: discountAmount > 0 ? parsedDiscountValue : null,
        discount_amount: discountAmount,
        amount: netAmount,
        line_items: itemsPayload,
        customer_email: customerEmail.trim().toLowerCase(),
        customer_name: customerName.trim() || null,
        created_by: user?.id || null,
      };

      if (isRecurring) {
        // For monthly rows the invoices_schedule_monthly_parent trigger
        // recomputes next/last send on the database clock; these are previews.
        const now = new Date();
        insertPayload.is_recurring = true;
        insertPayload.recurring_interval_days = intervalDays;
        insertPayload.recurring_active = true;
        insertPayload.recurring_next_send_at = computeFirstScheduledSend(now);
        insertPayload.recurring_day_of_month = isMonthly ? sendDay : null;
        insertPayload.recurring_last_sent_at = sendsNow ? now.toISOString() : null;
        insertPayload.recurring_template_only = !sendsNow;
      }

      const { data: invoice, error: insertError } = await supabase
        .from("invoices" as any)
        .insert(insertPayload)
        .select()
        .single();

      if (insertError) throw insertError;
      const invoiceData = invoice as any;

      // Wait-until-day: nothing goes out now. The parent stays as the template
      // and the cron sends the first invoice on the chosen day.
      if (!sendsNow) {
        toast({
          title: "Recurring invoice scheduled",
          description: `First invoice goes to ${customerEmail.trim()} on ${formatSendDate(
            new Date(invoiceData.recurring_next_send_at)
          )} at 3:00 PM ET, then on ${sendDayPhrase(sendDay)} of every month.`,
        });
        resetForm();
        onSuccess();
        return;
      }

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

      if (fnError) {
        if (!isRecurring) throw fnError;
        // The parent is already scheduled for next month. If the first invoice
        // never went out, stop the schedule so the cron does not start billing
        // a customer who never got invoice #1, and so the row reads as a
        // failure rather than a healthy recurring invoice.
        // Only when create-invoice itself answered with an error: a network
        // or relay error does not prove it stopped running, and stopping an
        // invoice it is still sending would invite a duplicate by hand. Also
        // guarded on payment_url like process-recurring-invoices.
        if (fnError instanceof FunctionsHttpError) {
          const { data: stopped, error: stopError } = await supabase
            .from("invoices" as any)
            .update({ recurring_active: false })
            .eq("id", invoiceData.id)
            .is("payment_url", null)
            .select("id");
          if (!stopError && stopped && (stopped as unknown[]).length > 0) {
            throw new Error(
              `Invoice ${invoiceData.invoice_number} was not sent and its recurring schedule was stopped. Delete it and try again.`
            );
          }
        }
        throw new Error(
          `Invoice ${invoiceData.invoice_number} may not have been sent, and its recurring schedule is still active. Check the list before resending.`
        );
      }

      const recurringNote = !isRecurring
        ? ""
        : isMonthly
        ? ` Recurring on ${sendDayPhrase(sendDay)} of every month.`
        : ` Recurring every ${intervalDays} day${intervalDays !== 1 ? "s" : ""}.`;

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

            <div className="pt-3 border-t space-y-3">
              <div className="flex items-center gap-2">
                <Label htmlFor="invoice-discount" className="text-sm text-muted-foreground shrink-0">
                  Discount
                </Label>
                <div className="flex rounded-md border overflow-hidden shrink-0">
                  <button
                    type="button"
                    onClick={() => setDiscountType("percent")}
                    disabled={loading}
                    className={`px-3 py-1.5 text-sm transition-colors ${
                      discountType === "percent"
                        ? "bg-primary text-primary-foreground"
                        : "bg-background hover:bg-muted"
                    }`}
                  >
                    %
                  </button>
                  <button
                    type="button"
                    onClick={() => setDiscountType("fixed")}
                    disabled={loading}
                    className={`px-3 py-1.5 text-sm transition-colors border-l ${
                      discountType === "fixed"
                        ? "bg-primary text-primary-foreground"
                        : "bg-background hover:bg-muted"
                    }`}
                  >
                    $
                  </button>
                </div>
                <Input
                  id="invoice-discount"
                  type="number"
                  step="0.01"
                  min="0"
                  max={discountType === "percent" ? 100 : undefined}
                  placeholder={discountType === "percent" ? "0" : "0.00"}
                  value={discountValue}
                  onChange={(e) => setDiscountValue(e.target.value)}
                  disabled={loading}
                  className="w-28"
                />
                {discountAmount > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {discountType === "percent"
                      ? `${parsedDiscountValue}% off`
                      : "off the subtotal"}
                  </span>
                )}
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Subtotal</span>
                  <span className="text-sm">
                    ${subtotal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
                {discountAmount > 0 && (
                  <>
                    <div className="flex items-center justify-between text-green-600">
                      <span className="text-sm">
                        Discount
                        {discountType === "percent" ? ` (${parsedDiscountValue}%)` : ""}
                      </span>
                      <span className="text-sm">
                        −${discountAmount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">After discount</span>
                      <span className="text-sm">
                        ${netAmount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                  </>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Processing Fee ({(PROCESSING_FEE_RATE * 100).toFixed(2)}%)</span>
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

                {isMonthly && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <Label htmlFor="recurring-send-day" className="text-sm text-muted-foreground">
                        Send on day
                      </Label>
                      <SendDaySelect
                        id="recurring-send-day"
                        value={sendDay}
                        onChange={setSendDay}
                        disabled={loading}
                      />
                    </div>
                    <RadioGroup
                      value={firstSend}
                      onValueChange={(v) => setFirstSend(v as FirstSend)}
                      disabled={loading}
                      className="gap-2"
                    >
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="now" id="first-send-now" />
                        <Label htmlFor="first-send-now" className="text-sm font-normal cursor-pointer">
                          Send first invoice now
                        </Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="wait" id="first-send-wait" />
                        <Label htmlFor="first-send-wait" className="text-sm font-normal cursor-pointer">
                          Wait until the chosen day
                        </Label>
                      </div>
                    </RadioGroup>
                  </div>
                )}

                {intervalDays > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {isMonthly && !sendsNow
                      ? "Nothing is sent now. First invoice on "
                      : "First invoice sent now. Next one on "}
                    {formatSendDate(new Date(computeFirstScheduledSend(new Date())))} at 3:00 PM ET,
                    then{" "}
                    {isMonthly
                      ? `on ${sendDayPhrase(sendDay)} of every month.`
                      : `every ${intervalDays} day${intervalDays !== 1 ? "s" : ""}.`}
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
            {!isRecurring
              ? "Create & Send Invoice"
              : sendsNow
              ? "Create & Send Recurring Invoice"
              : "Create & Schedule Recurring Invoice"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
