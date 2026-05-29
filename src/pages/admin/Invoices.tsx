import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  FileText,
  Plus,
  ExternalLink,
  Copy,
  CopyPlus,
  Trash2,
  RefreshCw,
  Square,
  Zap,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import CreateInvoiceDialog, { type InvoiceInitialData } from "@/components/admin/CreateInvoiceDialog";

interface Invoice {
  id: string;
  invoice_number: string;
  title: string;
  description: string | null;
  amount: number;
  customer_email: string;
  customer_name: string | null;
  payment_status: string;
  payment_url: string | null;
  paid_at: string | null;
  created_at: string;
  line_items: { label: string; amount: number }[] | null;
  is_recurring: boolean;
  recurring_active: boolean;
  recurring_interval_days: number | null;
  recurring_next_send_at: string | null;
  recurring_parent_id: string | null;
}

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pending: { label: "Pending", variant: "secondary" },
  paid: { label: "Paid", variant: "default" },
  expired: { label: "Expired", variant: "destructive" },
  cancelled: { label: "Cancelled", variant: "outline" },
};

function frequencyLabel(days: number | null): string {
  if (!days) return "";
  if (days === 7) return "Weekly";
  if (days === 14) return "Bi-weekly";
  if (days === 30) return "Monthly";
  return `Every ${days}d`;
}

export default function Invoices() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [duplicateData, setDuplicateData] = useState<InvoiceInitialData | null>(null);

  const { data: invoices, isLoading, refetch } = useQuery({
    queryKey: ["admin-invoices"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices" as any)
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as unknown as Invoice[];
    },
  });

  const copyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Payment link copied to clipboard" });
    } catch {
      toast({
        title: "Payment link ready",
        description: url,
      });
    }
  };

  const deleteInvoice = async (id: string, invoiceNumber: string) => {
    if (!confirm(`Are you sure you want to delete invoice ${invoiceNumber}? This cannot be undone.`)) {
      return;
    }

    const { error } = await (supabase as any)
      .from("invoices")
      .delete()
      .eq("id", id);

    if (error) {
      toast({ title: "Failed to delete invoice", description: error.message, variant: "destructive" });
    } else {
      toast({ title: `Invoice ${invoiceNumber} deleted` });
      refetch();
    }
  };

  const stopRecurring = async (id: string, invoiceNumber: string) => {
    if (!confirm(`Stop recurring for invoice ${invoiceNumber}? No more automatic invoices will be sent.`)) {
      return;
    }

    const { error } = await (supabase as any)
      .from("invoices")
      .update({ recurring_active: false })
      .eq("id", id);

    if (error) {
      toast({ title: "Failed to stop recurring", description: error.message, variant: "destructive" });
    } else {
      toast({ title: `Recurring stopped for ${invoiceNumber}` });
      refetch();
    }
  };

  const duplicateInvoice = (inv: Invoice) => {
    setDuplicateData({
      title: inv.title,
      description: inv.description,
      lineItems: inv.line_items ?? [],
      customerEmail: inv.customer_email,
      customerName: inv.customer_name,
    });
    setDialogOpen(true);
  };

  const totalPending = invoices?.filter((i) => i.payment_status === "pending").length ?? 0;
  const totalPaid = invoices?.filter((i) => i.payment_status === "paid").length ?? 0;
  const totalRevenue =
    invoices
      ?.filter((i) => i.payment_status === "paid")
      .reduce((sum, i) => sum + Number(i.amount), 0) ?? 0;
  const activeRecurring = invoices?.filter((i) => i.recurring_active).length ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Invoices</h1>
          <p className="text-muted-foreground">
            Create and manage standalone invoices
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Create New Invoice
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalPending}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Paid</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{totalPaid}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Revenue</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              ${totalRevenue.toLocaleString("en-US", { minimumFractionDigits: 2 })}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Recurring</CardTitle>
            <RefreshCw className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">{activeRecurring}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Invoices</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground text-center py-8">Loading...</p>
          ) : !invoices?.length ? (
            <p className="text-muted-foreground text-center py-8">
              No invoices yet. Click "Create New Invoice" to get started.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice #</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map((inv) => {
                    const status = statusConfig[inv.payment_status] ?? statusConfig.pending;
                    const isParentRecurring = inv.is_recurring && !inv.recurring_parent_id;
                    const isChild = !!inv.recurring_parent_id;
                    return (
                      <TableRow key={inv.id}>
                        <TableCell className="font-mono text-xs">
                          {inv.invoice_number}
                        </TableCell>
                        <TableCell className="max-w-[200px]">
                          <div className="font-medium truncate">{inv.title}</div>
                          {inv.line_items && inv.line_items.length > 0 && (
                            <div className="text-xs text-muted-foreground">
                              {inv.line_items.length} item{inv.line_items.length !== 1 ? "s" : ""}
                            </div>
                          )}
                          {isParentRecurring && (
                            <div className="mt-1 flex flex-col gap-0.5">
                              <Badge
                                variant={inv.recurring_active ? "default" : "outline"}
                                className="text-[10px] px-1.5 py-0 w-fit"
                              >
                                <RefreshCw className="h-3 w-3 mr-1" />
                                {inv.recurring_active ? "Recurring" : "Stopped"}{" "}
                                {frequencyLabel(inv.recurring_interval_days)}
                              </Badge>
                              {inv.recurring_active && inv.recurring_next_send_at && (
                                <span className="text-[10px] text-muted-foreground">
                                  Next: {format(new Date(inv.recurring_next_send_at), "MMM d, yyyy")} 3 PM ET
                                </span>
                              )}
                            </div>
                          )}
                          {isChild && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 w-fit mt-1">
                              <Zap className="h-3 w-3 mr-1" />
                              Auto-sent
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="text-sm">{inv.customer_email}</div>
                          {inv.customer_name && (
                            <div className="text-xs text-muted-foreground">
                              {inv.customer_name}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          ${Number(inv.amount).toFixed(2)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={status.variant}>{status.label}</Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {format(new Date(inv.created_at), "MMM d, yyyy")}
                          {inv.paid_at && (
                            <div className="text-xs text-green-600">
                              Paid {format(new Date(inv.paid_at), "MMM d")}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            {inv.payment_url && inv.payment_status === "pending" && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => copyLink(inv.payment_url!)}
                                  title="Copy payment link"
                                >
                                  <Copy className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  asChild
                                  title="Open payment link"
                                >
                                  <a
                                    href={inv.payment_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    <ExternalLink className="h-4 w-4" />
                                  </a>
                                </Button>
                              </>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => duplicateInvoice(inv)}
                              title="Duplicate invoice"
                            >
                              <CopyPlus className="h-4 w-4" />
                            </Button>
                            {inv.recurring_active && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => stopRecurring(inv.id, inv.invoice_number)}
                                title="Stop recurring"
                                className="text-amber-600 hover:text-amber-700"
                              >
                                <Square className="h-4 w-4" />
                              </Button>
                            )}
                            {inv.payment_status !== "paid" && !inv.recurring_active && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => deleteInvoice(inv.id, inv.invoice_number)}
                                title="Delete invoice"
                                className="text-destructive hover:text-destructive"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <CreateInvoiceDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setDuplicateData(null);
        }}
        onSuccess={() => {
          refetch();
          setDialogOpen(false);
          setDuplicateData(null);
        }}
        initialData={duplicateData}
      />
    </div>
  );
}
