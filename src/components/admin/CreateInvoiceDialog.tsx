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
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export default function CreateInvoiceDialog({ open, onOpenChange, onSuccess }: Props) {
  const { toast } = useToast();
  const { user } = useAuth();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [loading, setLoading] = useState(false);

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setAmount("");
    setCustomerEmail("");
    setCustomerName("");
  };

  const handleSubmit = async () => {
    if (!title.trim()) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }

    const parsedAmount = parseFloat(amount);
    if (!parsedAmount || parsedAmount <= 0) {
      toast({ title: "Enter a valid amount greater than $0", variant: "destructive" });
      return;
    }

    if (!customerEmail.trim() || !customerEmail.includes("@")) {
      toast({ title: "Enter a valid email address", variant: "destructive" });
      return;
    }

    setLoading(true);

    try {
      const { data: invoice, error: insertError } = await supabase
        .from("invoices" as any)
        .insert({
          title: title.trim(),
          description: description.trim() || null,
          amount: parsedAmount,
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
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Create New Invoice</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="invoice-title">Title *</Label>
            <Input
              id="invoice-title"
              placeholder="e.g. Additional Decoration Services"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={loading}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="invoice-desc">Description</Label>
            <Textarea
              id="invoice-desc"
              placeholder="Optional details about this invoice..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={loading}
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="invoice-amount">Amount (USD) *</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                $
              </span>
              <Input
                id="invoice-amount"
                type="number"
                step="0.01"
                min="1"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={loading}
                className="pl-7"
              />
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
