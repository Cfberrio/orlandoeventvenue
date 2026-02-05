import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon, DollarSign, Download } from "lucide-react";
import { format, startOfMonth, endOfMonth, subMonths } from "date-fns";
import { useRevenueData } from "@/hooks/useRevenueData";
import DailyRevenueView from "@/components/admin/revenue/DailyRevenueView";
import MonthlyRevenueView from "@/components/admin/revenue/MonthlyRevenueView";
import CategoryBreakdown from "@/components/admin/revenue/CategoryBreakdown";
import SegmentAnalysis from "@/components/admin/revenue/SegmentAnalysis";
import ExportButton from "@/components/admin/revenue/ExportButton";

export default function RevenueReports() {
  const [dateFrom, setDateFrom] = useState<Date>(subMonths(startOfMonth(new Date()), 1));
  const [dateTo, setDateTo] = useState<Date>(endOfMonth(new Date()));
  const [activeTab, setActiveTab] = useState<string>("daily");

  const { exportRevenueCsv } = useRevenueData();

  const startDate = format(dateFrom, "yyyy-MM-dd");
  const endDate = format(dateTo, "yyyy-MM-dd");

  return (
    <div className="space-y-6 pb-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Revenue Reports</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Detailed revenue breakdown by category, time, and segment
          </p>
        </div>
        <ExportButton 
          startDate={startDate} 
          endDate={endDate}
          onExport={exportRevenueCsv}
        />
      </div>

      {/* Date Range Filter */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Date Range</CardTitle>
          <CardDescription>Select the date range for revenue analysis</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <label className="text-sm font-medium mb-2 block">From</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button 
                    variant="outline" 
                    className="w-full justify-start text-left font-normal"
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {format(dateFrom, "PPP")}
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
            </div>

            <div className="flex-1">
              <label className="text-sm font-medium mb-2 block">To</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button 
                    variant="outline" 
                    className="w-full justify-start text-left font-normal"
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {format(dateTo, "PPP")}
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

            <div className="flex items-end">
              <Button 
                variant="secondary"
                onClick={() => {
                  setDateFrom(subMonths(startOfMonth(new Date()), 1));
                  setDateTo(endOfMonth(new Date()));
                }}
              >
                Reset to Last 2 Months
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabs for different views */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="daily">Daily</TabsTrigger>
          <TabsTrigger value="monthly">Monthly</TabsTrigger>
          <TabsTrigger value="category">By Category</TabsTrigger>
          <TabsTrigger value="segment">By Segment</TabsTrigger>
        </TabsList>

        <TabsContent value="daily" className="mt-6 space-y-4">
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
