import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DollarSign, Clock, Users } from "lucide-react";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { usePayrollData } from "@/hooks/usePayrollData";
import PayrollOverviewView from "@/components/admin/payroll/PayrollOverviewView";
import StandaloneAssignmentsView from "@/components/admin/payroll/StandaloneAssignmentsView";
import PayrollDateRangePicker from "@/components/admin/payroll/PayrollDateRangePicker";

export default function PayrollReports() {
  const today = new Date();
  const [dateRange, setDateRange] = useState<{ startDate: Date; endDate: Date }>({
    startDate: startOfMonth(today),
    endDate: endOfMonth(today),
  });
  const [activeTab, setActiveTab] = useState<string>("overview");
  const [summaryData, setSummaryData] = useState<any>(null);

  const { fetchPayrollLineItems } = usePayrollData();

  const startDate = format(dateRange.startDate, "yyyy-MM-dd");
  const endDate = format(dateRange.endDate, "yyyy-MM-dd");

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
          Pagos a personal — Custodial, Asistente y Producción
        </p>
      </div>

      {/* Date Range Picker */}
      <PayrollDateRangePicker
        startDate={dateRange.startDate}
        endDate={dateRange.endDate}
        onChange={setDateRange}
      />

      {/* Summary Cards */}
      {summaryData && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Adeudado</CardTitle>
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
              <CardTitle className="text-sm font-medium">✅ Pagado</CardTitle>
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
              <CardTitle className="text-sm font-medium">⏳ Pendiente</CardTitle>
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
              <CardTitle className="text-sm font-medium">👥 Personal</CardTitle>
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
          <TabsTrigger value="overview">📋 Todo el Personal</TabsTrigger>
          <TabsTrigger value="standalone">🧹 Limpiezas Independientes</TabsTrigger>
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
