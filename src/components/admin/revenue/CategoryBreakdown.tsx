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
import { useRevenueData, CategoryRevenueRecord } from "@/hooks/useRevenueData";
import { Skeleton } from "@/components/ui/skeleton";
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts";
import { money, pct, splitCategories } from "@/lib/reportMoney";
import { revenueCategoryLabel, revenueItemTypeLabel } from "@/lib/statusLabels";

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
  bar_service: "#0ea5e9",
  invoice: "#64748b",
  cancelled_kept: "#f97316",
  fee: "#ef4444",
  tax: "#6b7280",
  discount: "#f43f5e",
  card_fee: "#94a3b8",
};

// ClickUp 86e40ach2 R2-8: the pie shows only money that came in; discounts are
// a deduction under it and every % is taken over gross (before discounts).
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
        setError("Failed to load category breakdown data");
        console.error(result.error);
      } else {
        setData(result.data);
      }
      setIsLoading(false);
    };
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate]);

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

  const split = splitCategories(data);
  const pieChartData = split.revenue.map((r) => ({
    name: revenueCategoryLabel(r.category),
    value: r.amount,
    color: CATEGORY_COLORS[r.category] || "#94a3b8",
  }));
  const detail = [...data]
    .filter((r) => r.category !== "card_fee")
    .sort((a, b) => Number(b.total_amount) - Number(a.total_amount));
  const feeRows = data.filter((r) => r.category === "card_fee");

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Revenue Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={350}>
              <PieChart>
                <Pie
                  data={pieChartData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(1)}%`}
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {pieChartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(value: number) => money(value)} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
            <div className="text-center mt-4">
              <p className="text-sm text-muted-foreground">Gross before discounts</p>
              <p className="text-2xl font-bold">{money(split.gross)}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Category Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {split.revenue.map((item) => {
                const share = split.gross ? (item.amount / split.gross) * 100 : 0;
                return (
                  <div key={item.category} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: CATEGORY_COLORS[item.category] || "#94a3b8" }}
                        />
                        <span className="font-medium">{revenueCategoryLabel(item.category)}</span>
                      </div>
                      <span className="font-bold">{money(item.amount)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: `${share}%`, backgroundColor: CATEGORY_COLORS[item.category] || "#94a3b8" }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground w-12 text-right">{share.toFixed(1)}%</span>
                    </div>
                  </div>
                );
              })}

              <div className="border-t pt-3 space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Gross before discounts</span>
                  <span className="font-medium">{money(split.gross)}</span>
                </div>
                {split.deductions.map((d) => (
                  <div key={d.category} className="flex justify-between text-destructive">
                    <span>
                      Less {revenueCategoryLabel(d.category).toLowerCase()} ({pct(-d.amount, split.gross)} of gross)
                    </span>
                    <span>{money(d.amount)}</span>
                  </div>
                ))}
                <div className="flex justify-between font-bold">
                  <span>Collected (net)</span>
                  <span>{money(split.net)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Card fees paid by guests (on top, not revenue)</span>
                  <span>{money(split.cardFees)}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Detailed Breakdown by Item Type</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Category</TableHead>
                  <TableHead>Item Type</TableHead>
                  <TableHead className="text-right">Total Amount</TableHead>
                  <TableHead className="text-right">Item Count</TableHead>
                  <TableHead className="text-right">% of Gross</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...detail, ...feeRows].map((item, index) => {
                  const isFee = item.category === "card_fee";
                  return (
                    <TableRow key={index} className={isFee ? "text-muted-foreground" : undefined}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div
                            className="w-2 h-2 rounded-full"
                            style={{ backgroundColor: CATEGORY_COLORS[item.category] || "#94a3b8" }}
                          />
                          <span className="font-medium">{revenueCategoryLabel(item.category)}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {revenueItemTypeLabel(item.category, item.item_type)}
                      </TableCell>
                      <TableCell
                        className={`text-right font-medium ${Number(item.total_amount) < 0 ? "text-destructive" : ""}`}
                      >
                        {money(item.total_amount)}
                      </TableCell>
                      <TableCell className="text-right">{item.item_count}</TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {isFee ? "on top" : pct(Number(item.total_amount), split.gross, 2)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
