import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useRevenueData, SegmentRevenueRecord } from "@/hooks/useRevenueData";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, Globe, Calendar, Layers } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface SegmentAnalysisProps {
  startDate: string;
  endDate: string;
}

type SegmentType = 'booking_origin' | 'event_type' | 'booking_type';

const SEGMENT_CONFIG: Record<SegmentType, { label: string; description: string; icon: React.ComponentType<any> }> = {
  booking_origin: { 
    label: "By Source", 
    description: "Website, Internal, External bookings",
    icon: Globe 
  },
  event_type: { 
    label: "By Event Type", 
    description: "Birthday, Wedding, Corporate, etc.",
    icon: Calendar 
  },
  booking_type: { 
    label: "By Package", 
    description: "Hourly vs Daily rentals",
    icon: Layers 
  },
};

export default function SegmentAnalysis({ startDate, endDate }: SegmentAnalysisProps) {
  const [segmentBy, setSegmentBy] = useState<SegmentType>('event_type');
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
    Bookings: Number(item.booking_count),
  })).sort((a, b) => b.Revenue - a.Revenue) || [];

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <Skeleton className="h-10 w-full" />
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
            <Users className="h-12 w-12 mx-auto text-muted-foreground/50" />
            <p className="text-muted-foreground font-medium">No Segment Data</p>
            <p className="text-sm text-muted-foreground">
              No revenue data found for the selected date range
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const config = SEGMENT_CONFIG[segmentBy];
  const Icon = config.icon;

  return (
    <div className="space-y-4">
      {/* Segment Selector */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-2">
            {(Object.entries(SEGMENT_CONFIG) as [SegmentType, typeof SEGMENT_CONFIG[SegmentType]][]).map(([key, value]) => {
              const SegmentIcon = value.icon;
              const isActive = segmentBy === key;
              return (
                <Button
                  key={key}
                  variant={isActive ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSegmentBy(key)}
                  className="flex items-center gap-2"
                >
                  <SegmentIcon className="h-4 w-4" />
                  {value.label}
                </Button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Icon className="h-5 w-5 text-muted-foreground" />
            Revenue {config.label}
          </CardTitle>
          <CardDescription>{config.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={Math.max(200, chartData.length * 50)}>
            <BarChart data={chartData} layout="vertical" margin={{ left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" horizontal={false} />
              <XAxis 
                type="number"
                tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
                className="text-xs"
              />
              <YAxis 
                type="category" 
                dataKey="segment" 
                width={120} 
                className="text-xs"
                tick={{ fontSize: 12 }}
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
                radius={[0, 4, 4, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Segment Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {chartData.map((item, index) => {
          const percentage = (item.Revenue / totalRevenue) * 100;
          const avgPerBooking = item.Bookings > 0 ? item.Revenue / item.Bookings : 0;
          
          return (
            <Card key={item.segment} className={index === 0 ? "border-primary/30 bg-primary/5" : ""}>
              <CardContent className="pt-6">
                <div className="space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold text-lg">{item.segment}</h3>
                      <p className="text-sm text-muted-foreground">
                        {item.Bookings} booking{item.Bookings !== 1 ? 's' : ''}
                      </p>
                    </div>
                    {index === 0 && (
                      <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded-full font-medium">
                        Top
                      </span>
                    )}
                  </div>
                  
                  <div className="space-y-1">
                    <div className="flex justify-between items-end">
                      <span className="text-2xl font-bold">
                        ${item.Revenue.toLocaleString()}
                      </span>
                      <span className="text-muted-foreground text-sm">
                        {percentage.toFixed(0)}%
                      </span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all duration-500"
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>

                  <div className="pt-2 border-t text-sm text-muted-foreground">
                    Avg per booking: <span className="font-medium text-foreground">${avgPerBooking.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Summary */}
      <Card className="bg-muted/30">
        <CardContent className="pt-6">
          <div className="flex flex-wrap justify-center gap-8 text-center">
            <div>
              <p className="text-sm text-muted-foreground">Total Revenue</p>
              <p className="text-2xl font-bold text-primary">${totalRevenue.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Bookings</p>
              <p className="text-2xl font-bold">{totalBookings}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Segments</p>
              <p className="text-2xl font-bold">{chartData.length}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}