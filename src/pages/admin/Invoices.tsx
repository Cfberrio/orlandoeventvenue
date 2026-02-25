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
import { FileText, Plus, ExternalLink, Copy } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import CreateInvoiceDialog from "@/components/admin/CreateInvoiceDialog";

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
}

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pending: { label: "Pending", variant: "secondary" },
  paid: { label: "Paid", variant: "default" },
  expired: { label: "Expired", variant: "destructive" },
  cancelled: { label: "Cancelled", variant: "outline" },
};

export default function Invoices() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: invoices, isLoading, refetch } = useQuery({
    queryKey: ["admin-invoices"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as Invoice[];
    },
  });

  const copyLink = (url: string) => {
    navigator.clipboard.writeText(url);
    toast({ title: "Payment link copied to clipboard" });
  };

  const totalPending = invoices?.filter((i) => i.payment_status === "pending").length ?? 0;
  const totalPaid = invoices?.filter((i) => i.payment_status === "paid").length ?? 0;
  const totalRevenue =
    invoices
      ?.filter((i) => i.payment_status === "paid")
      .reduce((sum, i) => sum + Number(i.amount), 0) ?? 0;

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

      <div className="grid gap-4 md:grid-cols-3">
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
                    return (
                      <TableRow key={inv.id}>
                        <TableCell className="font-mono text-xs">
                          {inv.invoice_number}
                        </TableCell>
                        <TableCell className="font-medium max-w-[200px] truncate">
                          {inv.title}
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
        onOpenChange={setDialogOpen}
        onSuccess={() => {
          refetch();
          setDialogOpen(false);
        }}
      />
    </div>
  );
}
