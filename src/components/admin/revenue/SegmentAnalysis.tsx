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
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { avg, money } from "@/lib/reportMoney";
import { bookingOriginLabel, bookingTypeLabel, humanizeCode } from "@/lib/statusLabels";

interface SegmentAnalysisProps {
  startDate: string;
  endDate: string;
}

type SegmentType = "booking_origin" | "event_type" | "booking_type";

const SEGMENT_LABELS: Record<SegmentType, string> = {
  booking_origin: "Booking Origin",
  event_type: "Event Type",
  booking_type: "Booking Type",
};

function segmentLabel(by: SegmentType, value: string | null): string {
  if (!value) return "Unknown";
  if (by === "booking_origin") return bookingOriginLabel(value);
  if (by === "booking_type") return bookingTypeLabel(value);
  return humanizeCode(value);
}

// ClickUp 86e40ach2 R2-4/R2-7: every origin is listed. "Collected" is booking
// money OEV received (net, before card fees); "External" is what a platform
// collected and is never added to Collected. Standalone invoices have no
// booking, so they are not segmented here.
export default function SegmentAnalysis({ startDate, endDate }: SegmentAnalysisProps) {
  const [segmentBy, setSegmentBy] = useState<SegmentType>("booking_origin");
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
        setError("Failed to load segment analysis data");
        console.error(result.error);
      } else {
        setData(result.data);
      }
      setIsLoading(false);
    };
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate, segmentBy]);

  const rows = data ?? [];
  const totalRevenue = rows.reduce((sum, item) => sum + Number(item.total_revenue), 0);
  const totalBookings = rows.reduce((sum, item) => sum + Number(item.booking_count), 0);
  const totalExternal = rows.reduce((sum, item) => sum + Number(item.external_amount || 0), 0);
  const totalExternalCount = rows.reduce((sum, item) => sum + Number(item.external_count || 0), 0);

  const chartData = rows.map((item) => ({
    segment: segmentLabel(segmentBy, item.segment),
    Collected: Number(item.total_revenue),
    "External (platform)": Number(item.external_amount || 0),
  }));

  const selector = (
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
  );

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
      <div className="space-y-4">
        {selector}
        <Card>
          <CardContent className="pt-6">
            <p className="text-destructive">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="space-y-4">
        {selector}
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground text-center">No revenue data found for this date range</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {selector}

      <Card>
        <CardHeader>
          <CardTitle>Revenue by {SEGMENT_LABELS[segmentBy]}</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={350}>
            <BarChart data={chartData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" tickFormatter={(value) => money(value)} />
              <YAxis type="category" dataKey="segment" width={140} />
              <Tooltip formatter={(value: number) => money(value)} />
              <Legend />
              <Bar dataKey="Collected" fill="#3b82f6" />
              <Bar dataKey="External (platform)" fill="#cbd5e1" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Detailed Segment Analysis</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Collected = booking money OEV received, net of discounts and before card fees. External = paid on the
            platform (Peerspace, etc.), shown apart. Standalone invoices are not tied to a booking and are not
            segmented.
          </p>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{SEGMENT_LABELS[segmentBy]}</TableHead>
                  <TableHead className="text-right">Collected</TableHead>
                  <TableHead className="text-right">Bookings</TableHead>
                  <TableHead className="text-right">Avg/Booking</TableHead>
                  <TableHead className="text-right">% of Collected</TableHead>
                  <TableHead className="text-right text-muted-foreground">External (platform)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((item, index) => {
                  const percentage = totalRevenue ? (Number(item.total_revenue) / totalRevenue) * 100 : 0;
                  return (
                    <TableRow key={index}>
                      <TableCell className="font-medium">{segmentLabel(segmentBy, item.segment)}</TableCell>
                      <TableCell className="text-right font-bold">{money(item.total_revenue)}</TableCell>
                      <TableCell className="text-right">{item.booking_count}</TableCell>
                      <TableCell className="text-right">{money(item.avg_revenue)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-16 h-2 bg-muted rounded-full overflow-hidden">
                            <div className="h-full bg-primary rounded-full" style={{ width: `${percentage}%` }} />
                          </div>
                          <span className="text-muted-foreground w-12">{percentage.toFixed(1)}%</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {Number(item.external_amount) !== 0
                          ? `${money(item.external_amount)} (${item.external_count})`
                          : "-"}
                      </TableCell>
                    </TableRow>
                  );
                })}
                <TableRow className="bg-muted/50 font-bold">
                  <TableCell>TOTAL</TableCell>
                  <TableCell className="text-right">{money(totalRevenue)}</TableCell>
                  <TableCell className="text-right">{totalBookings}</TableCell>
                  <TableCell className="text-right">{money(avg(totalRevenue, totalBookings))}</TableCell>
                  <TableCell className="text-right">100.0%</TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {totalExternal !== 0 ? `${money(totalExternal)} (${totalExternalCount})` : "-"}
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
