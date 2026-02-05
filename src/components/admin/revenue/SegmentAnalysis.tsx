import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useRevenueData, SegmentRevenueRecord } from "@/hooks/useRevenueData";
import { Skeleton } from "@/components/ui/skeleton";
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

interface SegmentAnalysisProps {
  startDate: string;
  endDate: string;
}

type SegmentType = 'booking_origin' | 'event_type' | 'booking_type';

const SEGMENT_LABELS: Record<SegmentType, string> = {
  booking_origin: "Booking Origin",
  event_type: "Event Type",
  booking_type: "Booking Type",
};

export default function SegmentAnalysis({ startDate, endDate }: SegmentAnalysisProps) {
  const [segmentBy, setSegmentBy] = useState<SegmentType>('booking_origin');
  const [data, setData] = useState<SegmentRevenueRecord[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { fetchRevenueBySegment } = useRevenueData();

  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      setError(null);
      
      const result = await fetchRevenueBySegment(startDate, endDate, segmentBy);
      
      if (result.error) {
        setError('Failed to load segment analysis data');
        console.error(result.error);
      } else {
        setData(result.data);
      }
      
      setIsLoading(false);
    };

    loadData();
  }, [startDate, endDate, segmentBy]);

  const totalRevenue = data?.reduce((sum, item) => sum + Number(item.total_revenue), 0) || 0;
  const totalBookings = data?.reduce((sum, item) => sum + Number(item.booking_count), 0) || 0;

  // Format data for chart
  const chartData = data?.map((item) => ({
    segment: item.segment || 'Unknown',
    Revenue: Number(item.total_revenue),
    'Avg Revenue': Number(item.avg_revenue),
  })) || [];

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <Skeleton className="h-10 w-48" />
          </CardHeader>
        </Card>
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
      {/* Segment Selector */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle>Segment By</CardTitle>
            <Select value={segmentBy} onValueChange={(v) => setSegmentBy(v as SegmentType)}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(SEGMENT_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
      </Card>

      {/* Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Revenue by {SEGMENT_LABELS[segmentBy]}</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={350}>
            <BarChart data={chartData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis 
                type="number"
                tickFormatter={(value) => `$${value.toLocaleString()}`}
              />
              <YAxis type="category" dataKey="segment" width={120} />
              <Tooltip 
                formatter={(value: number) => `$${value.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
              />
              <Legend />
              <Bar dataKey="Revenue" fill="#3b82f6" />
              <Bar dataKey="Avg Revenue" fill="#8b5cf6" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Detailed Table */}
      <Card>
        <CardHeader>
          <CardTitle>Detailed Segment Analysis</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{SEGMENT_LABELS[segmentBy]}</TableHead>
                  <TableHead className="text-right">Total Revenue</TableHead>
                  <TableHead className="text-right">Bookings</TableHead>
                  <TableHead className="text-right">Avg Revenue/Booking</TableHead>
                  <TableHead className="text-right">% of Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data
                  .sort((a, b) => Number(b.total_revenue) - Number(a.total_revenue))
                  .map((item, index) => {
                    const percentage = (Number(item.total_revenue) / totalRevenue) * 100;
                    return (
                      <TableRow key={index}>
                        <TableCell className="font-medium">
                          {item.segment || 'Unknown'}
                        </TableCell>
                        <TableCell className="text-right font-bold">
                          ${Number(item.total_revenue).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="text-right">
                          {item.booking_count}
                        </TableCell>
                        <TableCell className="text-right">
                          ${Number(item.avg_revenue).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-16 h-2 bg-muted rounded-full overflow-hidden">
                              <div
                                className="h-full bg-primary rounded-full"
                                style={{ width: `${percentage}%` }}
                              />
                            </div>
                            <span className="text-muted-foreground w-12">
                              {percentage.toFixed(1)}%
                            </span>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                {/* Totals Row */}
                <TableRow className="bg-muted/50 font-bold">
                  <TableCell>TOTAL</TableCell>
                  <TableCell className="text-right">
                    ${totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="text-right">
                    {totalBookings}
                  </TableCell>
                  <TableCell className="text-right">
                    ${(totalRevenue / totalBookings).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="text-right">100.0%</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
