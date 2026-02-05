import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon, DollarSign, TrendingUp, Users, Calendar as CalendarIcon2 } from "lucide-react";
import { format, startOfMonth, endOfMonth, subMonths, startOfYear, subDays } from "date-fns";
import { useRevenueData } from "@/hooks/useRevenueData";
import DailyRevenueView from "@/components/admin/revenue/DailyRevenueView";
import MonthlyRevenueView from "@/components/admin/revenue/MonthlyRevenueView";
import CategoryBreakdown from "@/components/admin/revenue/CategoryBreakdown";
import SegmentAnalysis from "@/components/admin/revenue/SegmentAnalysis";
import ExportButton from "@/components/admin/revenue/ExportButton";

const DATE_PRESETS = [
  { label: "This Month", getValue: () => ({ from: startOfMonth(new Date()), to: new Date() }) },
  { label: "Last Month", getValue: () => ({ from: startOfMonth(subMonths(new Date(), 1)), to: endOfMonth(subMonths(new Date(), 1)) }) },
  { label: "Last 90 Days", getValue: () => ({ from: subDays(new Date(), 90), to: new Date() }) },
  { label: "Year to Date", getValue: () => ({ from: startOfYear(new Date()), to: new Date() }) },
];

export default function RevenueReports() {
  const [dateFrom, setDateFrom] = useState<Date>(startOfMonth(new Date()));
  const [dateTo, setDateTo] = useState<Date>(new Date());
  const [activeTab, setActiveTab] = useState<string>("overview");

  const { exportRevenueCsv, fetchDailyRevenue } = useRevenueData();

  const startDate = format(dateFrom, "yyyy-MM-dd");
  const endDate = format(dateTo, "yyyy-MM-dd");

  const applyPreset = (preset: typeof DATE_PRESETS[0]) => {
    const { from, to } = preset.getValue();
    setDateFrom(from);
    setDateTo(to);
  };

  return (
    <div className="space-y-6 pb-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <DollarSign className="h-6 w-6 text-primary" />
            Revenue Reports
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Track your earnings and analyze revenue trends
          </p>
        </div>
        <ExportButton 
          startDate={startDate} 
          endDate={endDate}
          onExport={exportRevenueCsv}
        />
      </div>

      {/* Quick Date Presets + Custom Range */}
      <Card>
        <CardContent className="pt-6">
          <div className="space-y-4">
            {/* Quick Presets */}
            <div className="flex flex-wrap gap-2">
              {DATE_PRESETS.map((preset) => (
                <Button
                  key={preset.label}
                  variant="outline"
                  size="sm"
                  onClick={() => applyPreset(preset)}
                  className="text-sm"
                >
                  {preset.label}
                </Button>
              ))}
            </div>

            {/* Custom Date Range */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 pt-2 border-t">
              <span className="text-sm font-medium text-muted-foreground">Custom Range:</span>
              <div className="flex items-center gap-2">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button 
                      variant="outline" 
                      size="sm"
                      className="justify-start text-left font-normal min-w-[140px]"
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {format(dateFrom, "MMM d, yyyy")}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={dateFrom}
                      onSelect={(d) => d && setDateFrom(d)}
                      initialFocus
                      className="pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>

                <span className="text-muted-foreground">to</span>

                <Popover>
                  <PopoverTrigger asChild>
                    <Button 
                      variant="outline" 
                      size="sm"
                      className="justify-start text-left font-normal min-w-[140px]"
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {format(dateTo, "MMM d, yyyy")}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={dateTo}
                      onSelect={(d) => d && setDateTo(d)}
                      initialFocus
                      className="pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabs for different views */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2 lg:grid-cols-4 h-auto">
          <TabsTrigger value="overview" className="flex flex-col py-3 px-2">
            <CalendarIcon2 className="h-4 w-4 mb-1" />
            <span className="text-xs sm:text-sm">Daily View</span>
          </TabsTrigger>
          <TabsTrigger value="monthly" className="flex flex-col py-3 px-2">
            <TrendingUp className="h-4 w-4 mb-1" />
            <span className="text-xs sm:text-sm">Monthly Trends</span>
          </TabsTrigger>
          <TabsTrigger value="category" className="flex flex-col py-3 px-2">
            <DollarSign className="h-4 w-4 mb-1" />
            <span className="text-xs sm:text-sm">By Category</span>
          </TabsTrigger>
          <TabsTrigger value="segment" className="flex flex-col py-3 px-2">
            <Users className="h-4 w-4 mb-1" />
            <span className="text-xs sm:text-sm">By Segment</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6 space-y-4">
          <DailyRevenueView startDate={startDate} endDate={endDate} />
        </TabsContent>

        <TabsContent value="monthly" className="mt-6 space-y-4">
          <MonthlyRevenueView startDate={startDate} endDate={endDate} />
        </TabsContent>

        <TabsContent value="category" className="mt-6 space-y-4">
          <CategoryBreakdown startDate={startDate} endDate={endDate} />
        </TabsContent>

        <TabsContent value="segment" className="mt-6 space-y-4">
          <SegmentAnalysis startDate={startDate} endDate={endDate} />
        </TabsContent>
      </Tabs>
    </div>
  );
}