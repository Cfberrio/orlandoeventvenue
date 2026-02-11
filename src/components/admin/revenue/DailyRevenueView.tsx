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
import { useRevenueData, DailyRevenueRecord } from "@/hooks/useRevenueData";
import { format } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";

interface DailyRevenueViewProps {
  startDate: string;
  endDate: string;
}

export default function DailyRevenueView({ startDate, endDate }: DailyRevenueViewProps) {
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
        setError('Failed to load daily revenue data');
        console.error(result.error);
      } else {
        setData(result.data);
      }
      
      setIsLoading(false);
    };

    loadData();
  }, [startDate, endDate]);

  // Calculate totals
  const totals = data?.reduce(
    (acc, day) => ({
      total_revenue: acc.total_revenue + Number(day.total_revenue || 0),
      baseline_revenue: acc.baseline_revenue + Number(day.baseline_revenue || 0),
      cleaning_revenue: acc.cleaning_revenue + Number(day.cleaning_revenue || 0),
      production_revenue: acc.production_revenue + Number(day.production_revenue || 0),
      addon_revenue: acc.addon_revenue + Number(day.addon_revenue || 0),
      fee_revenue: acc.fee_revenue + Number(day.fee_revenue || 0),
      discount_amount: acc.discount_amount + Number(day.discount_amount || 0),
      tax_amount: acc.tax_amount + Number(day.tax_amount || 0),
      booking_count: acc.booking_count + Number(day.booking_count || 0),
    }),
    {
      total_revenue: 0,
      baseline_revenue: 0,
      cleaning_revenue: 0,
      production_revenue: 0,
      addon_revenue: 0,
      fee_revenue: 0,
      discount_amount: 0,
      tax_amount: 0,
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
          <p className="text-muted-foreground text-center">No revenue data found for this date range</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ${totals?.total_revenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Across {totals?.booking_count} bookings
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Days with Revenue</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.length}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Active event days
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Revenue/Day</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ${(totals!.total_revenue / data.length).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Average per event day
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Daily Breakdown Table */}
      <Card>
        <CardHeader>
          <CardTitle>Daily Revenue Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Bookings</TableHead>
                  <TableHead className="text-right">Baseline</TableHead>
                  <TableHead className="text-right">Cleaning</TableHead>
                  <TableHead className="text-right">Production</TableHead>
                  <TableHead className="text-right">Add-ons</TableHead>
                  <TableHead className="text-right">Fees</TableHead>
                  <TableHead className="text-right">Discounts</TableHead>
                  <TableHead className="text-right">Tax</TableHead>
                  <TableHead className="text-right font-bold">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((day) => (
                  <TableRow key={day.revenue_date}>
                    <TableCell className="font-medium">
                      {format(new Date(day.revenue_date + 'T00:00:00'), "MM/dd/yyyy")}
                    </TableCell>
                    <TableCell className="text-right">{day.booking_count}</TableCell>
                    <TableCell className="text-right">
                      ${Number(day.baseline_revenue).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-right">
                      ${Number(day.cleaning_revenue).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-right">
                      ${Number(day.production_revenue).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-right">
                      ${Number(day.addon_revenue).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-right">
                      ${Number(day.fee_revenue).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-right text-destructive">
                      {Number(day.discount_amount) !== 0 
                        ? `$${Number(day.discount_amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}`
                        : '-'}
                    </TableCell>
                    <TableCell className="text-right">
                      ${Number(day.tax_amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-right font-bold">
                      ${Number(day.total_revenue).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </TableCell>
                  </TableRow>
                ))}
                {/* Totals Row */}
                <TableRow className="bg-muted/50 font-bold">
                  <TableCell>TOTAL</TableCell>
                  <TableCell className="text-right">{totals?.booking_count}</TableCell>
                  <TableCell className="text-right">
                    ${totals?.baseline_revenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="text-right">
                    ${totals?.cleaning_revenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="text-right">
                    ${totals?.production_revenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="text-right">
                    ${totals?.addon_revenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="text-right">
                    ${totals?.fee_revenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="text-right text-destructive">
                    ${totals?.discount_amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="text-right">
                    ${totals?.tax_amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="text-right">
                    ${totals?.total_revenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
