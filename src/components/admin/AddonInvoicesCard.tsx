// E-9 (86e40ach2): add-on invoices could not be listed or voided. 17 were
// pending ($7,051.50), with duplicates (CNZQVC 3 x $596). List the unpaid ones
// across bookings, flag duplicates, and void through manage-invoice.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Ban } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import InvoiceActionDialog, { type InvoiceActionTarget } from "./InvoiceActionDialog";
import { duplicateAddonIds } from "@/lib/addonInvoices";

interface AddonRow {
  id: string;
  booking_id: string;
  total_amount: number | null;
  total_charged: number | null;
  payment_status: string;
  created_at: string;
  link_created_at: string | null;
  package: string | null;
  bar_package_label: string | null;
  setup_breakdown: boolean | null;
  tablecloths: boolean | null;
  bookings: { reservation_number: string | null; full_name: string | null; event_date: string | null; status: string | null } | null;
}

function describe(row: AddonRow): string {
  const parts: string[] = [];
  if (row.package && row.package !== "none") parts.push(`${row.package} package`);
  if (row.bar_package_label) parts.push(`bar: ${row.bar_package_label}`);
  if (row.setup_breakdown) parts.push("setup");
  if (row.tablecloths) parts.push("tablecloths");
  return parts.join(", ") || "Add-ons";
}

export default function AddonInvoicesCard() {
  const [target, setTarget] = useState<InvoiceActionTarget | null>(null);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin-addon-invoices-unpaid"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("booking_addon_invoices" as never)
        .select(
          "id, booking_id, total_amount, total_charged, payment_status, created_at, link_created_at, package, bar_package_label, setup_breakdown, tablecloths, bookings(reservation_number, full_name, event_date, status)",
        )
        .in("payment_status", ["pending", "expired"])
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as AddonRow[];
    },
  });

  const rows = data ?? [];
  const dupes = useMemo(() => duplicateAddonIds(rows), [rows]);
  const pendingTotal = rows
    .filter((r) => r.payment_status === "pending")
    .reduce((s, r) => s + Number(r.total_charged ?? r.total_amount ?? 0), 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Unpaid add-on invoices</CardTitle>
        <CardDescription>
          Add-ons billed on bookings and not paid yet
          {rows.length > 0 && ` · ${rows.length} open · $${pendingTotal.toFixed(2)} pending`}. Void duplicates and ones the guest
          will not pay; voiding closes the payment link.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-muted-foreground text-sm">Loading…</p>
        ) : error ? (
          <p className="text-destructive text-sm">Could not load add-on invoices: {(error as Error).message}</p>
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">No unpaid add-on invoices.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Booking</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const amount = Number(r.total_charged ?? r.total_amount ?? 0);
                  const res = r.bookings?.reservation_number ?? "Booking";
                  return (
                    <TableRow key={r.id}>
                      <TableCell>
                        <Link className="underline font-mono text-xs" to={`/admin/bookings/${r.booking_id}`}>
                          {res}
                        </Link>
                        <div className="text-xs text-muted-foreground">
                          {r.bookings?.full_name}
                          {r.bookings?.event_date ? ` · ${r.bookings.event_date}` : ""}
                          {r.bookings?.status === "cancelled" ? " · booking cancelled" : ""}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{describe(r)}</TableCell>
                      <TableCell className="text-right font-medium">${amount.toFixed(2)}</TableCell>
                      <TableCell>
                        <Badge variant={r.payment_status === "expired" ? "outline" : "secondary"}>
                          {r.payment_status === "expired" ? "Link expired" : "Pending"}
                        </Badge>
                        {dupes.has(r.id) && (
                          <Badge variant="destructive" className="ml-1">
                            Duplicate
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{format(new Date(r.created_at), "MMM d, yyyy")}</TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Void add-on invoice"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setTarget({ action: "void", kind: "addon", id: r.id, label: `${res} add-on`, amount })}
                        >
                          <Ban className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
      <InvoiceActionDialog target={target} onClose={() => setTarget(null)} onDone={() => refetch()} />
    </Card>
  );
}
