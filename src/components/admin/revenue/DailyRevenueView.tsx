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
import { DollarSign, TrendingUp, Calendar } from "lucide-react";
import { useRevenueData, DailyRevenueRecord, RevenueSummary } from "@/hooks/useRevenueData";
import { format } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { avg, money } from "@/lib/reportMoney";

interface DailyRevenueViewProps {
  startDate: string;
  endDate: string;
  /** Range totals from SQL: the distinct booking count lives here (R2-6). */
  summary: RevenueSummary | null;
}

const SUM_KEYS = [
  "baseline_revenue",
  "cleaning_revenue",
  "production_revenue",
  "addon_revenue",
  "bar_revenue",
  "other_revenue",
  "discount_amount",
  "total_revenue",
  "invoice_revenue",
  "cancelled_kept_revenue",
  "collected_net",
  "card_fees",
  "collected_gross",
] as const;

type SumKey = (typeof SUM_KEYS)[number];

export default function DailyRevenueView({ startDate, endDate, summary }: DailyRevenueViewProps) {
  const [data, setData] = useState<DailyRevenueRecord[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { fetchDailyRevenue } = useRevenueData();

  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      setError(null);
      const result = await fetchDailyRevenue(startDate, endDate);
      if (result.error) {
        setError("Failed to load daily revenue data");
        console.error(result.error);
      } else {
        setData(result.data);
      }
      setIsLoading(false);
    };
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate]);

  // Only days where OEV collected something. Days with only external or
  // unrecorded-cancelled money are counted in the summary cards, not here.
  const rows = (data ?? []).filter((d) => Number(d.collected_gross) !== 0 || Number(d.total_revenue) !== 0);

  const totals = rows.reduce(
    (acc, day) => {
      for (const k of SUM_KEYS) acc[k] += Number(day[k] || 0);
      return acc;
    },
    Object.fromEntries(SUM_KEYS.map((k) => [k, 0])) as Record<SumKey, number>,
  );
  const showOther = Math.abs(totals.other_revenue) > 0.004;
  const showKept = Math.abs(totals.cancelled_kept_revenue) > 0.004;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-4 w-24" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-32" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Card>
          <CardContent className="pt-6">
            <Skeleton className="h-64 w-full" />
          </CardContent>
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

  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-muted-foreground text-center">No money collected in this date range</p>
        </CardContent>
      </Card>
    );
  }

  const bookingCount = summary?.booking_count ?? null;
  const cell = (v: number) => <TableCell className="text-right">{money(v)}</TableCell>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Collected (net)</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{money(totals.collected_net)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {bookingCount === null ? "" : `${bookingCount} distinct booking${Number(bookingCount) === 1 ? "" : "s"} paid`}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Days with payments</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{rows.length}</div>
            <p className="text-xs text-muted-foreground mt-1">Orlando days on which money was received</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg collected per payment day</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{money(avg(totals.collected_net, rows.length))}</div>
            <p className="text-xs text-muted-foreground mt-1">Net, before card fees</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Daily Revenue Breakdown</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            By the Orlando day the payment came in. Booking columns + discounts = Booking total. Booking total +
            invoices{showKept ? " + kept on cancelled" : ""} = Net. Net + card fees = Gross.
          </p>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Bookings</TableHead>
                  <TableHead className="text-right">Rental</TableHead>
                  <TableHead className="text-right">Cleaning</TableHead>
                  <TableHead className="text-right">Production</TableHead>
                  <TableHead className="text-right">Add-ons</TableHead>
                  <TableHead className="text-right">Bar</TableHead>
                  {showOther && <TableHead className="text-right">Other</TableHead>}
                  <TableHead className="text-right">Discounts</TableHead>
                  <TableHead className="text-right">Booking total</TableHead>
                  <TableHead className="text-right">Invoices</TableHead>
                  {showKept && <TableHead className="text-right">Kept (cancelled)</TableHead>}
                  <TableHead className="text-right font-bold">Net</TableHead>
                  <TableHead className="text-right">Card fees</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((day) => (
                  <TableRow key={day.revenue_date}>
                    <TableCell className="font-medium">
                      {format(new Date(day.revenue_date + "T00:00:00"), "MM/dd/yyyy")}
                    </TableCell>
                    <TableCell className="text-right">{day.booking_count}</TableCell>
                    {cell(day.baseline_revenue)}
                    {cell(day.cleaning_revenue)}
                    {cell(day.production_revenue)}
                    {cell(day.addon_revenue)}
                    {cell(day.bar_revenue)}
                    {showOther && cell(day.other_revenue)}
                    <TableCell className="text-right text-destructive">
                      {Number(day.discount_amount) !== 0 ? money(day.discount_amount) : "-"}
                    </TableCell>
                    {cell(day.total_revenue)}
                    {cell(day.invoice_revenue)}
                    {showKept && cell(day.cancelled_kept_revenue)}
                    <TableCell className="text-right font-bold">{money(day.collected_net)}</TableCell>
                    {cell(day.card_fees)}
                    {cell(day.collected_gross)}
                  </TableRow>
                ))}
                <TableRow className="bg-muted/50 font-bold">
                  <TableCell>TOTAL</TableCell>
                  <TableCell className="text-right" title="Distinct bookings in the range (a booking paid on two days counts once)">
                    {bookingCount ?? "—"}
                  </TableCell>
                  {cell(totals.baseline_revenue)}
                  {cell(totals.cleaning_revenue)}
                  {cell(totals.production_revenue)}
                  {cell(totals.addon_revenue)}
                  {cell(totals.bar_revenue)}
                  {showOther && cell(totals.other_revenue)}
                  <TableCell className="text-right text-destructive">{money(totals.discount_amount)}</TableCell>
                  {cell(totals.total_revenue)}
                  {cell(totals.invoice_revenue)}
                  {showKept && cell(totals.cancelled_kept_revenue)}
                  <TableCell className="text-right">{money(totals.collected_net)}</TableCell>
                  {cell(totals.card_fees)}
                  {cell(totals.collected_gross)}
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
