import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FileText, DollarSign, TrendingUp } from "lucide-react";
import { useRevenueData, PaidInvoiceRecord } from "@/hooks/useRevenueData";
import { format } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { invoiceMoney, money } from "@/lib/reportMoney";
import { orlandoYmd } from "@/lib/orlandoDay";

interface InvoiceRevenueViewProps {
  startDate: string;
  endDate: string;
}

export default function InvoiceRevenueView({ startDate, endDate }: InvoiceRevenueViewProps) {
  const [data, setData] = useState<PaidInvoiceRecord[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { fetchPaidInvoices } = useRevenueData();

  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      setError(null);

      const result = await fetchPaidInvoices(startDate, endDate);

      if (result.error) {
        setError("Failed to load invoice revenue data");
        console.error(result.error);
      } else {
        setData(result.data);
      }

      setIsLoading(false);
    };

    loadData();
  }, [startDate, endDate]);

  // R2-1/R2-10: net (amount) is what Collected counts; the card fee is shown
  // apart and is 0 for an invoice paid offline (cash, Zelle, check).
  const rows = (data ?? []).map((inv) => ({ inv, ...invoiceMoney(inv) }));
  const totalNet = rows.reduce((sum, r) => sum + r.net, 0);
  const totalFee = rows.reduce((sum, r) => sum + r.fee, 0);
  const totalGross = rows.reduce((sum, r) => sum + r.gross, 0);
  const invoiceCount = rows.length;
  const avgPerInvoice = invoiceCount > 0 ? totalNet / invoiceCount : 0;

  const fmt = (n: number) => money(n).replace("$", "");

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardHeader className="pb-2"><Skeleton className="h-4 w-24" /></CardHeader>
              <CardContent><Skeleton className="h-8 w-32" /></CardContent>
            </Card>
          ))}
        </div>
        <Card>
          <CardContent className="pt-6"><Skeleton className="h-40 w-full" /></CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-destructive">{error}</p>
        </CardContent>
      </Card>
    );
  }

  if (!data || data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Standalone Invoice Revenue
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-center py-4">
            No paid invoices found for this date range
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold flex items-center gap-2">
        <FileText className="h-5 w-5" />
        Standalone Invoice Revenue
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Invoice Revenue (net)</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${fmt(totalNet)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Included in Collected above · card fees ${fmt(totalFee)} · gross ${fmt(totalGross)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Invoices Paid</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{invoiceCount}</div>
            <p className="text-xs text-muted-foreground mt-1">Completed payments</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg per Invoice</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${fmt(avgPerInvoice)}</div>
            <p className="text-xs text-muted-foreground mt-1">Average net invoice amount</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Paid Invoices</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date Paid</TableHead>
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                  <TableHead className="text-right">Card fee</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(({ inv, net, fee, gross }) => (
                  <TableRow key={inv.id}>
                    <TableCell className="font-medium">
                      {format(new Date(orlandoYmd(inv.paid_at) + "T00:00:00"), "MM/dd/yyyy")}
                      {inv.paid_offline_method && (
                        <div className="text-xs text-muted-foreground font-normal">Paid offline ({inv.paid_offline_method})</div>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{inv.invoice_number}</TableCell>
                    <TableCell>
                      <div className="font-medium truncate max-w-[200px]">{inv.title}</div>
                      {inv.line_items && inv.line_items.length > 1 && (
                        <div className="text-xs text-muted-foreground">
                          {inv.line_items.length} items
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">{inv.customer_email}</div>
                      {inv.customer_name && (
                        <div className="text-xs text-muted-foreground">{inv.customer_name}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-medium">${fmt(net)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">${fmt(fee)}</TableCell>
                    <TableCell className="text-right">${fmt(gross)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/50 font-bold">
                  <TableCell>TOTAL</TableCell>
                  <TableCell />
                  <TableCell />
                  <TableCell className="text-right text-sm">{invoiceCount} invoices</TableCell>
                  <TableCell className="text-right">${fmt(totalNet)}</TableCell>
                  <TableCell className="text-right">${fmt(totalFee)}</TableCell>
                  <TableCell className="text-right">${fmt(totalGross)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
