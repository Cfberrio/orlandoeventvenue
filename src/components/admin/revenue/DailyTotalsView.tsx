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
import { useRevenueData, DailyGeneratedRevenueRecord } from "@/hooks/useRevenueData";
import { format } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";

interface DailyTotalsViewProps {
  startDate: string;
  endDate: string;
}

export default function DailyTotalsView({ startDate, endDate }: DailyTotalsViewProps) {
  const [data, setData] = useState<DailyGeneratedRevenueRecord[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { fetchDailyGeneratedRevenue } = useRevenueData();

  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      setError(null);
      
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
              ${totals?.total_generated.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
              Days with confirmed deposits
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
              ${(totals!.total_generated / data.length).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Average per deposit day
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Daily Breakdown Table */}
      <Card>
        <CardHeader>
          <CardTitle>Daily Generated Revenue</CardTitle>
          <p className="text-sm text-muted-foreground">
            Full booking amounts grouped by deposit payment date
          </p>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Deposit Date</TableHead>
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
                {data.map((day) => (
                  <TableRow key={day.generated_date}>
                    <TableCell className="font-medium">
                      {format(new Date(day.generated_date + 'T00:00:00'), "MMM dd, yyyy")}
                    </TableCell>
                    <TableCell className="text-right">{day.booking_count}</TableCell>
                    <TableCell className="text-right">
                      ${Number(day.baseline_generated).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-right">
                      ${Number(day.cleaning_generated).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-right">
                      ${Number(day.production_generated).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-right">
                      ${Number(day.addon_generated).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-right">
                      ${Number(day.tax_generated).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-right text-destructive">
                      {Number(day.discount_generated) !== 0
                        ? `$${Number(day.discount_generated).toLocaleString(undefined, { minimumFractionDigits: 2 })}`
                        : '-'}
                    </TableCell>
                    <TableCell className="text-right font-bold">
                      ${Number(day.total_generated).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </TableCell>
                  </TableRow>
                ))}
                {/* Totals Row */}
                <TableRow className="bg-muted/50 font-bold">
                  <TableCell>TOTAL</TableCell>
                  <TableCell className="text-right">{totals?.booking_count}</TableCell>
                  <TableCell className="text-right">
                    ${totals?.baseline_generated.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="text-right">
                    ${totals?.cleaning_generated.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="text-right">
                    ${totals?.production_generated.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="text-right">
                    ${totals?.addon_generated.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="text-right">
                    ${totals?.tax_generated.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="text-right text-destructive">
                    ${totals?.discount_generated.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="text-right">
                    ${totals?.total_generated.toLocaleString(undefined, { minimumFractionDigits: 2 })}
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
