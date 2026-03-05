import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DollarSign, Clock, Users, ChevronLeft, ChevronRight } from "lucide-react";
import { format, startOfMonth, endOfMonth, subMonths, addMonths } from "date-fns";
import { usePayrollData } from "@/hooks/usePayrollData";
import PayrollOverviewView from "@/components/admin/payroll/PayrollOverviewView";
import StandaloneAssignmentsView from "@/components/admin/payroll/StandaloneAssignmentsView";

export default function PayrollReports() {
  const [selectedMonth, setSelectedMonth] = useState<Date>(startOfMonth(new Date()));
  const [activeTab, setActiveTab] = useState<string>("overview");
  const [summaryData, setSummaryData] = useState<any>(null);

  const { fetchPayrollLineItems } = usePayrollData();

  const dateFrom = selectedMonth;
  const dateTo = endOfMonth(selectedMonth);
  const startDate = format(dateFrom, "yyyy-MM-dd");
  const endDate = format(dateTo, "yyyy-MM-dd");

  // Generate last 6 months for quick buttons
  const monthButtons = useMemo(() => {
    const months: Date[] = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      months.push(startOfMonth(subMonths(now, i)));
    }
    return months;
  }, []);

  const goToPrevMonth = () => setSelectedMonth(prev => startOfMonth(subMonths(prev, 1)));
  const goToNextMonth = () => {
    const next = startOfMonth(addMonths(selectedMonth, 1));
    if (next <= startOfMonth(new Date())) {
      setSelectedMonth(next);
    }
  };

  const isCurrentMonth = format(selectedMonth, "yyyy-MM") === format(new Date(), "yyyy-MM");

  useEffect(() => {
    const loadSummary = async () => {
      const result = await fetchPayrollLineItems(startDate, endDate);
      if (result.data) {
        const totalOwed = result.data.reduce((sum, item) => sum + Number(item.amount), 0);
        const totalPaid = result.data
          .filter(item => item.paid_status === 'paid')
          .reduce((sum, item) => sum + Number(item.amount), 0);
        const totalPending = result.data
          .filter(item => item.paid_status === 'pending')
          .reduce((sum, item) => sum + Number(item.amount), 0);
        const staffCount = new Set(result.data.map(item => item.staff_name)).size;
        
        setSummaryData({ totalOwed, totalPaid, totalPending, staffCount });
      } else {
        setSummaryData({ totalOwed: 0, totalPaid: 0, totalPending: 0, staffCount: 0 });
      }
    };
    
    loadSummary();
  }, [startDate, endDate]);

  return (
    <div className="space-y-6 pb-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">💰 Payroll</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Staff payment tracking — Custodial & Production
        </p>
      </div>

      {/* Month Selector */}
      <Card>
        <CardContent className="pt-5 pb-4">
          <div className="flex items-center gap-2 mb-3">
            <Button variant="ghost" size="icon" onClick={goToPrevMonth} className="h-8 w-8">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-lg font-semibold min-w-[160px] text-center">
              {format(selectedMonth, "MMMM yyyy")}
            </span>
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={goToNextMonth} 
              disabled={isCurrentMonth}
              className="h-8 w-8"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {monthButtons.map((month) => {
              const isSelected = format(month, "yyyy-MM") === format(selectedMonth, "yyyy-MM");
              return (
                <Button
                  key={month.toISOString()}
                  variant={isSelected ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedMonth(month)}
                  className="min-w-[80px]"
                >
                  {format(month, "MMM yyyy")}
                </Button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      {summaryData && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Owed</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                ${summaryData.totalOwed.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">✅ Paid</CardTitle>
              <Clock className="h-4 w-4 text-green-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">
                ${summaryData.totalPaid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">⏳ Pending</CardTitle>
              <Clock className="h-4 w-4 text-orange-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-orange-600">
                ${summaryData.totalPending.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">👥 Staff</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {summaryData.staffCount}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="overview">📋 All Staff Payroll</TabsTrigger>
          <TabsTrigger value="standalone">🧹 Standalone Cleanings</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6 space-y-4">
          <PayrollOverviewView startDate={startDate} endDate={endDate} />
        </TabsContent>

        <TabsContent value="standalone" className="mt-6 space-y-4">
          <StandaloneAssignmentsView startDate={startDate} endDate={endDate} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
