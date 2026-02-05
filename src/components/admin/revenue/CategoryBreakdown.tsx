import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useRevenueData, CategoryRevenueRecord } from "@/hooks/useRevenueData";
import { Skeleton } from "@/components/ui/skeleton";
import { DollarSign, PieChart as PieChartIcon } from "lucide-react";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

interface CategoryBreakdownProps {
  startDate: string;
  endDate: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  baseline: "#3b82f6",
  cleaning_base: "#8b5cf6",
  cleaning_surcharge: "#a855f7",
  production: "#f59e0b",
  addon: "#10b981",
  fee: "#06b6d4",
  discount: "#ef4444",
  tax: "#6b7280",
};

const CATEGORY_LABELS: Record<string, string> = {
  baseline: "Venue Rental",
  cleaning_base: "Cleaning Fee",
  cleaning_surcharge: "Celebration Surcharge",
  production: "Production Package",
  addon: "Add-ons",
  fee: "Fees",
  discount: "Discounts",
  tax: "Taxes",
};

export default function CategoryBreakdown({ startDate, endDate }: CategoryBreakdownProps) {
  const [data, setData] = useState<CategoryRevenueRecord[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { fetchRevenueByCategory } = useRevenueData();

  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      setError(null);
      
      const result = await fetchRevenueByCategory(startDate, endDate);
      
      if (result.error) {
        setError('Failed to load category breakdown data');
        console.error(result.error);
      } else {
        setData(result.data);
      }
      
      setIsLoading(false);
    };

    loadData();
  }, [startDate, endDate]);

  // Aggregate by main category for pie chart
  const categoryTotals = data?.reduce((acc, item) => {
    const category = item.category;
    if (!acc[category]) {
      acc[category] = 0;
    }
    acc[category] += Number(item.total_amount);
    return acc;
  }, {} as Record<string, number>);

  const pieChartData = categoryTotals
    ? Object.entries(categoryTotals)
        .filter(([_, amount]) => amount > 0) // Only positive amounts
        .map(([category, amount]) => ({
          name: CATEGORY_LABELS[category] || category,
          value: amount,
          color: CATEGORY_COLORS[category] || "#94a3b8",
        }))
        .sort((a, b) => b.value - a.value)
    : [];

  const totalRevenue = pieChartData.reduce((sum, item) => sum + item.value, 0);

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardContent className="pt-6">
            <Skeleton className="h-80 w-full" />
          </CardContent>
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
            <PieChartIcon className="h-12 w-12 mx-auto text-muted-foreground/50" />
            <p className="text-muted-foreground font-medium">No Category Data</p>
            <p className="text-sm text-muted-foreground">
              No revenue breakdown available for the selected date range
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Pie Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PieChartIcon className="h-5 w-5 text-muted-foreground" />
            Revenue Distribution
          </CardTitle>
          <CardDescription>How your revenue is split by category</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie
                data={pieChartData}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={100}
                paddingAngle={2}
                dataKey="value"
              >
                {pieChartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip 
                formatter={(value: number) => `$${value.toLocaleString()}`}
                contentStyle={{ 
                  backgroundColor: 'hsl(var(--card))', 
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px'
                }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="text-center -mt-4">
            <p className="text-sm text-muted-foreground">Total Revenue</p>
            <p className="text-3xl font-bold text-primary">
              ${totalRevenue.toLocaleString()}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Category List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-muted-foreground" />
            Category Breakdown
          </CardTitle>
          <CardDescription>Revenue by source category</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {pieChartData.map((item) => {
              const percentage = (item.value / totalRevenue) * 100;
              return (
                <div key={item.name} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-3 h-3 rounded-full flex-shrink-0"
                        style={{ backgroundColor: item.color }}
                      />
                      <span className="font-medium text-sm">{item.name}</span>
                    </div>
                    <div className="text-right">
                      <span className="font-bold">
                        ${item.value.toLocaleString()}
                      </span>
                      <span className="text-muted-foreground text-sm ml-2">
                        ({percentage.toFixed(0)}%)
                      </span>
                    </div>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${percentage}%`,
                        backgroundColor: item.color,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}