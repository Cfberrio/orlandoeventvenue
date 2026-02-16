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
import { DollarSign, TrendingUp, Calendar, ChevronDown, ChevronRight, ChevronsUpDown, ChevronsDownUp } from "lucide-react";
import { useRevenueData, DailyGeneratedRevenueRecord } from "@/hooks/useRevenueData";
import { format } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

interface DailyTotalsViewProps {
  startDate: string;
  endDate: string;
}

interface BookingDetail {
  id: string;
  reservation_number: string | null;
  full_name: string;
  email: string;
  event_date: string;
  event_type: string;
  booking_type: string;
  total_amount: number;
  base_rental: number;
  cleaning_fee: number;
  package_cost: number;
  optional_services: number;
  taxes_fees: number;
  discount_amount: number | null;
  payment_status: string;
  status: string;
  created_at: string;
}

export default function DailyTotalsView({ startDate, endDate }: DailyTotalsViewProps) {
  const [data, setData] = useState<DailyGeneratedRevenueRecord[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedDates, setExpandedDates] = useState<Record<string, BookingDetail[] | null>>({});
  const [loadingDates, setLoadingDates] = useState<Set<string>>(new Set());

  const { fetchDailyGeneratedRevenue, fetchBookingsByCreatedDate } = useRevenueData();

  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      setError(null);
      setExpandedDates({});
      
      const result = await fetchDailyGeneratedRevenue(startDate, endDate);
      
      if (result.error) {
        setError('Failed to load daily totals data');
        console.error(result.error);
      } else {
        setData(result.data);
      }
      
      setIsLoading(false);
    };

    loadData();
  }, [startDate, endDate]);

  const toggleDate = async (date: string) => {
    if (date in expandedDates) {
      const newExpanded = { ...expandedDates };
      delete newExpanded[date];
      setExpandedDates(newExpanded);
      return;
    }

    setLoadingDates(prev => new Set(prev).add(date));
    const result = await fetchBookingsByCreatedDate(date);
    setLoadingDates(prev => {
      const next = new Set(prev);
      next.delete(date);
      return next;
    });

    setExpandedDates(prev => ({
      ...prev,
      [date]: result.data as BookingDetail[] | null,
    }));
  };

  const expandAllDates = async () => {
    if (!data) return;

    const allExpanded = Object.keys(expandedDates).length === data.length;
    if (allExpanded) {
      setExpandedDates({});
      return;
    }

    const datesToFetch = data
      .map(d => d.generated_date)
      .filter(date => !(date in expandedDates));

    if (datesToFetch.length === 0) {
      setExpandedDates({});
      return;
    }

    setLoadingDates(new Set(datesToFetch));
    const results = await Promise.all(
      datesToFetch.map(async (date) => {
        const result = await fetchBookingsByCreatedDate(date);
        return { date, bookings: result.data as BookingDetail[] | null };
      })
    );
    setLoadingDates(new Set());

    const newExpanded = { ...expandedDates };
    results.forEach(({ date, bookings }) => {
      newExpanded[date] = bookings;
    });
    setExpandedDates(newExpanded);
  };

  const totals = data?.reduce(
    (acc, day) => ({
      total_generated: acc.total_generated + Number(day.total_generated || 0),
      baseline_generated: acc.baseline_generated + Number(day.baseline_generated || 0),
      cleaning_generated: acc.cleaning_generated + Number(day.cleaning_generated || 0),
      production_generated: acc.production_generated + Number(day.production_generated || 0),
      addon_generated: acc.addon_generated + Number(day.addon_generated || 0),
      tax_generated: acc.tax_generated + Number(day.tax_generated || 0),
      discount_generated: acc.discount_generated + Number(day.discount_generated || 0),
      booking_count: acc.booking_count + Number(day.booking_count || 0),
    }),
    {
      total_generated: 0,
      baseline_generated: 0,
      cleaning_generated: 0,
      production_generated: 0,
      addon_generated: 0,
      tax_generated: 0,
      discount_generated: 0,
      booking_count: 0,
    }
  );

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

  if (!data || data.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-muted-foreground text-center">No generated revenue data found for this date range</p>
        </CardContent>
      </Card>
    );
  }

  const fmtMoney = (v: number) => `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Generated</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {fmtMoney(totals?.total_generated || 0)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Full booking value across {totals?.booking_count} bookings
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Days with Bookings</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.length}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Days with confirmed bookings
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Generated/Day</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {fmtMoney(totals!.total_generated / data.length)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Average per booking day
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Daily Breakdown Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Daily Generated Revenue</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Full booking amounts grouped by booking creation date. Click a date to see individual bookings.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={expandAllDates}
              disabled={loadingDates.size > 0}
            >
              {data && Object.keys(expandedDates).length === data.length ? (
                <>
                  <ChevronsDownUp className="h-4 w-4 mr-1.5" />
                  Collapse All
                </>
              ) : (
                <>
                  <ChevronsUpDown className="h-4 w-4 mr-1.5" />
                  Expand All
                </>
              )}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead></TableHead>
                  <TableHead>Booked On</TableHead>
                  <TableHead className="text-right">Bookings</TableHead>
                  <TableHead className="text-right">Baseline</TableHead>
                  <TableHead className="text-right">Cleaning</TableHead>
                  <TableHead className="text-right">Production</TableHead>
                  <TableHead className="text-right">Add-ons</TableHead>
                  <TableHead className="text-right">Tax</TableHead>
                  <TableHead className="text-right">Discounts</TableHead>
                  <TableHead className="text-right font-bold">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((day) => {
                  const dateKey = day.generated_date;
                  const isExpanded = dateKey in expandedDates;
                  const isLoadingDate = loadingDates.has(dateKey);
                  const bookings = expandedDates[dateKey];

                  return (
                    <>
                      <TableRow
                        key={dateKey}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => toggleDate(dateKey)}
                      >
                        <TableCell className="w-8 px-2">
                          {isLoadingDate ? (
                            <Skeleton className="h-4 w-4" />
                          ) : isExpanded ? (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          )}
                        </TableCell>
                        <TableCell className="font-medium">
                          {format(new Date(dateKey + 'T00:00:00'), "MM/dd/yyyy")}
                        </TableCell>
                        <TableCell className="text-right">{day.booking_count}</TableCell>
                        <TableCell className="text-right">{fmtMoney(day.baseline_generated)}</TableCell>
                        <TableCell className="text-right">{fmtMoney(day.cleaning_generated)}</TableCell>
                        <TableCell className="text-right">{fmtMoney(day.production_generated)}</TableCell>
                        <TableCell className="text-right">{fmtMoney(day.addon_generated)}</TableCell>
                        <TableCell className="text-right">{fmtMoney(day.tax_generated)}</TableCell>
                        <TableCell className="text-right text-destructive">
                          {Number(day.discount_generated) !== 0
                            ? fmtMoney(day.discount_generated)
                            : '-'}
                        </TableCell>
                        <TableCell className="text-right font-bold">{fmtMoney(day.total_generated)}</TableCell>
                      </TableRow>
                      {isExpanded && bookings && bookings.map((b) => (
                        <TableRow key={b.id} className="bg-muted/30 text-sm">
                          <TableCell></TableCell>
                          <TableCell className="pl-6">
                            <div className="flex flex-col">
                              <span className="font-medium">{b.full_name}</span>
                              <span className="text-xs text-muted-foreground">
                                {b.reservation_number} · {b.event_type} · {format(new Date(b.event_date + 'T00:00:00'), "MM/dd")}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right text-xs text-muted-foreground">
                            {b.booking_type}
                          </TableCell>
                          <TableCell className="text-right">{fmtMoney(b.base_rental)}</TableCell>
                          <TableCell className="text-right">{fmtMoney(b.cleaning_fee)}</TableCell>
                          <TableCell className="text-right">{fmtMoney(b.package_cost)}</TableCell>
                          <TableCell className="text-right">{fmtMoney(b.optional_services)}</TableCell>
                          <TableCell className="text-right">{fmtMoney(b.taxes_fees)}</TableCell>
                          <TableCell className="text-right text-destructive">
                            {Number(b.discount_amount || 0) !== 0
                              ? fmtMoney(-1 * Number(b.discount_amount))
                              : '-'}
                          </TableCell>
                          <TableCell className="text-right font-semibold">{fmtMoney(b.total_amount)}</TableCell>
                        </TableRow>
                      ))}
                      {isExpanded && bookings && bookings.length === 0 && (
                        <TableRow key={`${dateKey}-empty`} className="bg-muted/30">
                          <TableCell></TableCell>
                          <TableCell colSpan={9} className="text-center text-sm text-muted-foreground py-3">
                            No bookings found for this date
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  );
                })}
                {/* Totals Row */}
                <TableRow className="bg-muted/50 font-bold">
                  <TableCell></TableCell>
                  <TableCell>TOTAL</TableCell>
                  <TableCell className="text-right">{totals?.booking_count}</TableCell>
                  <TableCell className="text-right">{fmtMoney(totals?.baseline_generated || 0)}</TableCell>
                  <TableCell className="text-right">{fmtMoney(totals?.cleaning_generated || 0)}</TableCell>
                  <TableCell className="text-right">{fmtMoney(totals?.production_generated || 0)}</TableCell>
                  <TableCell className="text-right">{fmtMoney(totals?.addon_generated || 0)}</TableCell>
                  <TableCell className="text-right">{fmtMoney(totals?.tax_generated || 0)}</TableCell>
                  <TableCell className="text-right text-destructive">{fmtMoney(totals?.discount_generated || 0)}</TableCell>
                  <TableCell className="text-right">{fmtMoney(totals?.total_generated || 0)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
