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
import { useRevenueData, MonthlyRevenueRecord, RevenueSummary } from "@/hooks/useRevenueData";
import { format } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { avg, money } from "@/lib/reportMoney";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

interface MonthlyRevenueViewProps {
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
  "external_amount",
  "cancelled_unrecorded_amount",
] as const;

type SumKey = (typeof SUM_KEYS)[number];

export default function MonthlyRevenueView({ startDate, endDate, summary }: MonthlyRevenueViewProps) {
  const [data, setData] = useState<MonthlyRevenueRecord[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { fetchMonthlyRevenue } = useRevenueData();

  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      setError(null);
      const result = await fetchMonthlyRevenue(startDate, endDate);
      if (result.error) {
        setError("Failed to load monthly revenue data");
        console.error(result.error);
      } else {
        setData(result.data);
      }
      setIsLoading(false);
    };
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate]);

  const rows = data ?? [];
  const totals = rows.reduce(
    (acc, m) => {
      for (const k of SUM_KEYS) acc[k] += Number(m[k] || 0);
      return acc;
    },
    Object.fromEntries(SUM_KEYS.map((k) => [k, 0])) as Record<SumKey, number>,
  );
  const showOther = Math.abs(totals.other_revenue) > 0.004;
  const showKept = Math.abs(totals.cancelled_kept_revenue) > 0.004;
  const bookingCount = summary?.booking_count ?? null;

  const chartData = rows.map((month) => ({
    month: format(new Date(month.year_month + "T00:00:00"), "MMM yyyy"),
    Rental: Number(month.baseline_revenue),
    Cleaning: Number(month.cleaning_revenue),
    Production: Number(month.production_revenue),
    "Add-ons": Number(month.addon_revenue),
    Bar: Number(month.bar_revenue || 0),
    Invoices: Number(month.invoice_revenue || 0),
  }));

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
            <Skeleton className="h-80 w-full" />
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
          <p className="text-muted-foreground text-center">No revenue data found for this date range</p>
        </CardContent>
      </Card>
    );
  }

  const cell = (v: number, extra = "") => <TableCell className={`text-right ${extra}`}>{money(v)}</TableCell>;

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
              Gross {money(totals.collected_gross)} incl. {money(totals.card_fees)} card fees
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Months with payments</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{rows.length}</div>
            <p className="text-xs text-muted-foreground mt-1">In the selected range</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg collected per month</CardTitle>
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
          <CardTitle>Revenue Trend by Category</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={350}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis tickFormatter={(value) => money(value)} />
              <Tooltip formatter={(value: number) => money(value)} />
              <Legend />
              <Bar dataKey="Rental" stackId="a" fill="#3b82f6" />
              <Bar dataKey="Cleaning" stackId="a" fill="#8b5cf6" />
              <Bar dataKey="Production" stackId="a" fill="#f59e0b" />
              <Bar dataKey="Add-ons" stackId="a" fill="#10b981" />
              <Bar dataKey="Bar" stackId="a" fill="#0ea5e9" />
              <Bar dataKey="Invoices" stackId="a" fill="#64748b" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Monthly Revenue Breakdown</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Booking columns + discounts = Booking total. Booking total + invoices
            {showKept ? " + kept on cancelled" : ""} = Net. Net + card fees = Gross. The last two columns are shown for
            reference and are not in any total.
          </p>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  <TableHead className="text-right">Bookings</TableHead>
                  <TableHead className="text-right">Rental</TableHead>
                  <TableHead className="text-right">Cleaning</TableHead>
                  <TableHead className="text-right">Production</TableHead>
                  <TableHead className="text-right">Add-ons</TableHead>
                  <TableHead className="text-right">Bar</TableHead>
                  {showOther && <TableHead className="text-right">Other</TableHead>}
                  <TableHead className="text-right">Discounts</TableHead>
                  <TableHead className="text-right">Booking total</TableHead>
                  <TableHead className="text-right">Avg/Booking</TableHead>
                  <TableHead className="text-right">Invoices</TableHead>
                  {showKept && <TableHead className="text-right">Kept (cancelled)</TableHead>}
                  <TableHead className="text-right font-bold">Net</TableHead>
                  <TableHead className="text-right">Card fees</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                  <TableHead className="text-right text-muted-foreground">External (platform)</TableHead>
                  <TableHead className="text-right text-muted-foreground">Cancelled, refund not recorded</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((month) => (
                  <TableRow key={month.revenue_month}>
                    <TableCell className="font-medium">
                      {format(new Date(month.year_month + "T00:00:00"), "MMMM yyyy")}
                    </TableCell>
                    <TableCell className="text-right">{month.booking_count}</TableCell>
                    {cell(month.baseline_revenue)}
                    {cell(month.cleaning_revenue)}
                    {cell(month.production_revenue)}
                    {cell(month.addon_revenue)}
                    {cell(month.bar_revenue)}
                    {showOther && cell(month.other_revenue)}
                    {cell(month.discount_amount, "text-destructive")}
                    {cell(month.total_revenue)}
                    {cell(avg(Number(month.total_revenue), Number(month.booking_count)), "text-muted-foreground")}
                    {cell(month.invoice_revenue)}
                    {showKept && cell(month.cancelled_kept_revenue)}
                    {cell(month.collected_net, "font-bold")}
                    {cell(month.card_fees)}
                    {cell(month.collected_gross)}
                    <TableCell className="text-right text-muted-foreground">
                      {Number(month.external_amount) !== 0 ? `${money(month.external_amount)} (${month.external_count})` : "-"}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {Number(month.cancelled_unrecorded_amount) !== 0
                        ? `${money(month.cancelled_unrecorded_amount)} (${month.cancelled_unrecorded_count})`
                        : "-"}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/50 font-bold">
                  <TableCell>TOTAL</TableCell>
                  <TableCell className="text-right" title="Distinct bookings in the range (a booking paid in two months counts once)">
                    {bookingCount ?? "—"}
                  </TableCell>
                  {cell(totals.baseline_revenue)}
                  {cell(totals.cleaning_revenue)}
                  {cell(totals.production_revenue)}
                  {cell(totals.addon_revenue)}
                  {cell(totals.bar_revenue)}
                  {showOther && cell(totals.other_revenue)}
                  {cell(totals.discount_amount, "text-destructive")}
                  {cell(totals.total_revenue)}
                  {cell(avg(totals.total_revenue, Number(bookingCount ?? 0)), "text-muted-foreground")}
                  {cell(totals.invoice_revenue)}
                  {showKept && cell(totals.cancelled_kept_revenue)}
                  {cell(totals.collected_net)}
                  {cell(totals.card_fees)}
                  {cell(totals.collected_gross)}
                  {cell(totals.external_amount, "text-muted-foreground")}
                  {cell(totals.cancelled_unrecorded_amount, "text-muted-foreground")}
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
