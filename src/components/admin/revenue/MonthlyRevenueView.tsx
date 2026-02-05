import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DollarSign, TrendingUp, Calendar, FileText } from "lucide-react";
import { useRevenueData, MonthlyRevenueRecord } from "@/hooks/useRevenueData";
import { format } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface MonthlyRevenueViewProps {
  startDate: string;
  endDate: string;
}

export default function MonthlyRevenueView({ startDate, endDate }: MonthlyRevenueViewProps) {
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
        setError('Failed to load monthly revenue data');
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
    (acc, month) => ({
      total_revenue: acc.total_revenue + Number(month.total_revenue || 0),
      baseline_revenue: acc.baseline_revenue + Number(month.baseline_revenue || 0),
      cleaning_revenue: acc.cleaning_revenue + Number(month.cleaning_revenue || 0),
      production_revenue: acc.production_revenue + Number(month.production_revenue || 0),
      addon_revenue: acc.addon_revenue + Number(month.addon_revenue || 0),
      booking_count: acc.booking_count + Number(month.booking_count || 0),
    }),
    {
      total_revenue: 0,
      baseline_revenue: 0,
      cleaning_revenue: 0,
      production_revenue: 0,
      addon_revenue: 0,
      booking_count: 0,
    }
  );

  // Format data for chart - simpler view
  const chartData = data?.map((month) => ({
    month: format(new Date(month.year_month + 'T00:00:00'), "MMM"),
    Revenue: Number(month.total_revenue),
    Bookings: Number(month.booking_count),
  })) || [];

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-4 w-20" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-24" />
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
      <Card className="border-destructive/50 bg-destructive/5">
        <CardContent className="pt-6">
          <p className="text-destructive text-center">{error}</p>
        </CardContent>
      </Card>
    );
  }

  if (!data || data.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="pt-6 pb-6">
          <div className="text-center space-y-2">
            <TrendingUp className="h-12 w-12 mx-auto text-muted-foreground/50" />
            <p className="text-muted-foreground font-medium">No Monthly Data</p>
            <p className="text-sm text-muted-foreground">
              No bookings found for the selected date range
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const avgPerMonth = data.length > 0 ? totals!.total_revenue / data.length : 0;
  const avgPerBooking = totals!.booking_count > 0 ? totals!.total_revenue / totals!.booking_count : 0;

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-primary/5 border-primary/20">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Revenue</CardTitle>
            <DollarSign className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-primary">
              ${totals?.total_revenue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Bookings</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totals?.booking_count}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Avg / Month</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ${avgPerMonth.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Avg / Booking</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ${avgPerBooking.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Revenue Trend</CardTitle>
          <CardDescription>Monthly revenue over time</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="month" className="text-xs" />
              <YAxis 
                tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
                className="text-xs"
              />
              <Tooltip 
                formatter={(value: number, name: string) => [
                  name === "Revenue" ? `$${value.toLocaleString()}` : value,
                  name
                ]}
                contentStyle={{ 
                  backgroundColor: 'hsl(var(--card))', 
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px'
                }}
              />
              <Bar 
                dataKey="Revenue" 
                fill="hsl(var(--primary))" 
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Monthly Breakdown Table */}
      <Card>
        <CardHeader>
          <CardTitle>Monthly Summary</CardTitle>
          <CardDescription>Revenue breakdown by month</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  <TableHead className="text-center">Bookings</TableHead>
                  <TableHead className="text-right">Rental</TableHead>
                  <TableHead className="text-right">Cleaning</TableHead>
                  <TableHead className="text-right">Production</TableHead>
                  <TableHead className="text-right">Extras</TableHead>
                  <TableHead className="text-right font-bold">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((month) => (
                  <TableRow key={month.revenue_month}>
                    <TableCell className="font-medium">
                      {format(new Date(month.year_month + 'T00:00:00'), "MMMM yyyy")}
                    </TableCell>
                    <TableCell className="text-center">
                      <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-muted text-xs font-medium">
                        {month.booking_count}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      ${Number(month.baseline_revenue).toLocaleString(undefined, { minimumFractionDigits: 0 })}
                    </TableCell>
                    <TableCell className="text-right">
                      ${Number(month.cleaning_revenue).toLocaleString(undefined, { minimumFractionDigits: 0 })}
                    </TableCell>
                    <TableCell className="text-right">
                      ${Number(month.production_revenue).toLocaleString(undefined, { minimumFractionDigits: 0 })}
                    </TableCell>
                    <TableCell className="text-right">
                      ${Number(month.addon_revenue).toLocaleString(undefined, { minimumFractionDigits: 0 })}
                    </TableCell>
                    <TableCell className="text-right font-bold">
                      ${Number(month.total_revenue).toLocaleString(undefined, { minimumFractionDigits: 0 })}
                    </TableCell>
                  </TableRow>
                ))}
                {/* Totals Row */}
                <TableRow className="bg-muted/50 font-bold border-t-2">
                  <TableCell>TOTAL</TableCell>
                  <TableCell className="text-center">
                    <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-primary/10 text-primary text-xs font-medium">
                      {totals?.booking_count}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    ${totals?.baseline_revenue.toLocaleString(undefined, { minimumFractionDigits: 0 })}
                  </TableCell>
                  <TableCell className="text-right">
                    ${totals?.cleaning_revenue.toLocaleString(undefined, { minimumFractionDigits: 0 })}
                  </TableCell>
                  <TableCell className="text-right">
                    ${totals?.production_revenue.toLocaleString(undefined, { minimumFractionDigits: 0 })}
                  </TableCell>
                  <TableCell className="text-right">
                    ${totals?.addon_revenue.toLocaleString(undefined, { minimumFractionDigits: 0 })}
                  </TableCell>
                  <TableCell className="text-right text-primary">
                    ${totals?.total_revenue.toLocaleString(undefined, { minimumFractionDigits: 0 })}
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