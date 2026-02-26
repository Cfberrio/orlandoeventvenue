import { useState } from "react";
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
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

interface LineItem {
  label: string;
  amount: string;
}

export default function CreateInvoiceDialog({ open, onOpenChange, onSuccess }: Props) {
  const { toast } = useToast();
  const { user } = useAuth();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [lineItems, setLineItems] = useState<LineItem[]>([{ label: "", amount: "" }]);
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [loading, setLoading] = useState(false);

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setLineItems([{ label: "", amount: "" }]);
    setCustomerEmail("");
    setCustomerName("");
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

    setLoading(true);

    try {
      const itemsPayload = validItems.map((item) => ({
        label: item.label.trim(),
        amount: parseFloat(item.amount),
      }));

      const { data: invoice, error: insertError } = await supabase
        .from("invoices" as any)
        .insert({
          title: title.trim(),
          description: description.trim() || null,
          amount: total,
          line_items: itemsPayload,
          customer_email: customerEmail.trim().toLowerCase(),
          customer_name: customerName.trim() || null,
          created_by: user?.id || null,
        })
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

      toast({
        title: "Invoice created & sent",
        description: `Payment link emailed to ${customerEmail.trim()}`,
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create New Invoice</DialogTitle>
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

            <div className="flex items-center justify-between pt-3 border-t">
              <span className="text-sm font-medium">Total</span>
              <span className="text-lg font-bold">
                ${total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
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
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Create & Send Invoice
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
