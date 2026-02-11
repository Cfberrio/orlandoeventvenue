import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DollarSign,
  Download,
  Calendar,
  CalendarIcon,
  Filter,
  CheckCircle2,
  Clock,
  FileText,
} from "lucide-react";
import { useStaffSession } from "@/hooks/useStaffSession";
import { useStaffPayrollData } from "@/hooks/useStaffPayrollData";
import { PayrollLineItem } from "@/hooks/usePayrollData";
import { format, startOfMonth, endOfMonth, parseISO } from "date-fns";
import { useToast } from "@/hooks/use-toast";

const PAY_TYPE_LABELS: Record<string, string> = {
  touch_up: "Touch-Up",
  regular: "Regular",
  deep: "Deep",
  production: "Production",
};

const PAY_CATEGORY_LABELS: Record<string, string> = {
  hourly_production: "Hourly (Production)",
  cleaning_base: "Cleaning Fee",
  cleaning_surcharge: "Celebration Surcharge",
  bonus: "Bonus",
  deduction: "Deduction",
};

export default function StaffPayments() {
  const { staffMember } = useStaffSession();
  const { fetchStaffPayrollSummary, fetchStaffPayrollLineItems, exportStaffPayrollCsv } = useStaffPayrollData();
  const { toast } = useToast();

  const now = new Date();
  const [startDate, setStartDate] = useState(format(startOfMonth(now), "yyyy-MM-dd"));
  const [endDate, setEndDate] = useState(format(endOfMonth(now), "yyyy-MM-dd"));
  const [sourceFilter, setSourceFilter] = useState<"all" | "booking" | "standalone">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "paid" | "pending">("all");

  const [lineItems, setLineItems] = useState<PayrollLineItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);

  const loadData = async () => {
    if (!staffMember?.id) return;
    setIsLoading(true);
    try {
      const { data } = await fetchStaffPayrollLineItems(staffMember.id, startDate, endDate);
      setLineItems(data || []);
    } catch (error) {
      console.error("Error loading payroll data:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [staffMember?.id, startDate, endDate]);

  // Apply client-side filters
  const filteredItems = useMemo(() => {
    let items = lineItems;

    if (sourceFilter === "booking") {
      items = items.filter((item) => item.booking_id != null);
    } else if (sourceFilter === "standalone") {
      items = items.filter((item) => item.booking_id == null);
    }

    if (statusFilter !== "all") {
      items = items.filter((item) => item.paid_status === statusFilter);
    }

    return items;
  }, [lineItems, sourceFilter, statusFilter]);

  // Compute totals from filtered items
  const totals = useMemo(() => {
    const totalAmount = filteredItems.reduce((sum, item) => sum + Number(item.amount), 0);
    const totalPaid = filteredItems
      .filter((item) => item.paid_status === "paid")
      .reduce((sum, item) => sum + Number(item.amount), 0);
    const totalPending = filteredItems
      .filter((item) => item.paid_status === "pending")
      .reduce((sum, item) => sum + Number(item.amount), 0);

    return { totalAmount, totalPaid, totalPending };
  }, [filteredItems]);

  const handleExport = async () => {
    if (!staffMember?.id) return;
    setIsExporting(true);
    try {
      const { success, error } = await exportStaffPayrollCsv(
        staffMember.id,
        startDate,
        endDate,
        {
          paidStatus: statusFilter,
          sourceFilter,
        }
      );
      if (success) {
        toast({ title: "Export Complete", description: "CSV file downloaded successfully." });
      } else {
        toast({ title: "Export Failed", description: String(error) || "No data to export.", variant: "destructive" });
      }
    } finally {
      setIsExporting(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(amount);
  };

  if (isLoading && lineItems.length === 0) {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-80 mt-2" />
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-24 w-full" />
              ))}
            </div>
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="h-6 w-6" />
            My Payments
          </CardTitle>
          <CardDescription>
            See what you've earned, what's been paid, and what's still pending. Filter by date and by booking vs standalone.
          </CardDescription>
        </CardHeader>
      </Card>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-100">
                <DollarSign className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Owed</p>
                <p className="text-2xl font-bold">{formatCurrency(totals.totalAmount)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-100">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Paid</p>
                <p className="text-2xl font-bold text-green-600">{formatCurrency(totals.totalPaid)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-orange-100">
                <Clock className="h-5 w-5 text-orange-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Pending</p>
                <p className="text-2xl font-bold text-orange-600">{formatCurrency(totals.totalPending)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Filter className="h-4 w-4" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            Show: all payments, only event bookings, or only standalone cleanings.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-1 block">From</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start text-left font-normal">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {format(parseISO(startDate + "T00:00:00"), "MM/dd/yyyy")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarComponent
                    mode="single"
                    selected={parseISO(startDate + "T00:00:00")}
                    onSelect={(d) => d && setStartDate(format(d, "yyyy-MM-dd"))}
                    initialFocus
                    className="pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-1 block">To</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start text-left font-normal">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {format(parseISO(endDate + "T00:00:00"), "MM/dd/yyyy")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarComponent
                    mode="single"
                    selected={parseISO(endDate + "T00:00:00")}
                    onSelect={(d) => d && setEndDate(format(d, "yyyy-MM-dd"))}
                    initialFocus
                    className="pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-1 block">Show</label>
              <Select value={sourceFilter} onValueChange={(value) => setSourceFilter(value as "all" | "booking" | "standalone")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="booking">Booking (event work)</SelectItem>
                  <SelectItem value="standalone">Standalone (no reservation)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-1 block">Status</label>
              <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as "all" | "paid" | "pending")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Line Items */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4" />
            Payment Details ({filteredItems.length} item{filteredItems.length !== 1 ? "s" : ""})
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={isExporting || filteredItems.length === 0}
          >
            <Download className="h-4 w-4 mr-1" />
            Export CSV
          </Button>
        </CardHeader>
        <CardContent>
          {filteredItems.length === 0 ? (
            <div className="text-center py-12 bg-muted/30 rounded-lg">
              <DollarSign className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground font-medium">No payment records found</p>
              <p className="text-sm text-muted-foreground mt-1">
                Try a different date range or change the filter (Booking / Standalone).
              </p>
            </div>
          ) : (
            <>
              {/* Desktop Table */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredItems.map((item) => (
                      <TableRow key={item.payroll_item_id}>
                        <TableCell className="whitespace-nowrap">
                          {item.assignment_date
                            ? format(new Date(item.assignment_date + "T00:00:00"), "MM/dd/yyyy")
                            : "—"}
                        </TableCell>
                        <TableCell>
                          {item.booking_id != null ? (
                            <div className="flex flex-col gap-1">
                              <Badge variant="secondary" className="w-fit text-xs">
                                Booking
                              </Badge>
                              {item.reservation_number && (
                                <span className="text-xs text-muted-foreground">{item.reservation_number}</span>
                              )}
                            </div>
                          ) : (
                            <Badge variant="outline" className="w-fit text-xs">
                              Standalone
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <span className="text-sm font-medium">
                              {PAY_CATEGORY_LABELS[item.pay_category] || item.pay_category}
                            </span>
                            {item.pay_type && (
                              <Badge variant="outline" className="w-fit text-xs">
                                {PAY_TYPE_LABELS[item.pay_type] || item.pay_type}
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="max-w-[200px]">
                          <span className="text-sm text-muted-foreground">
                            {item.description || "—"}
                          </span>
                          {item.hours && item.rate && (
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {item.hours}h x ${item.rate}/hr
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatCurrency(Number(item.amount))}
                        </TableCell>
                        <TableCell>
                          {item.paid_status === "paid" ? (
                            <Badge className="bg-green-100 text-green-700 hover:bg-green-100">
                              Paid
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="bg-orange-100 text-orange-700 hover:bg-orange-100">
                              Pending
                            </Badge>
                          )}
                          {item.paid_at && (
                            <p className="text-xs text-muted-foreground mt-1">
                              {format(new Date(item.paid_at), "MM/dd")}
                            </p>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile Cards */}
              <div className="md:hidden space-y-3">
                {filteredItems.map((item) => (
                  <div
                    key={item.payroll_item_id}
                    className="p-4 border rounded-lg bg-card"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        {item.booking_id != null ? (
                          <>
                            <Badge variant="secondary" className="text-xs mb-1">
                              Booking
                            </Badge>
                            {item.reservation_number && (
                              <p className="text-xs text-muted-foreground font-medium">{item.reservation_number}</p>
                            )}
                          </>
                        ) : (
                          <Badge variant="outline" className="text-xs mb-1">
                            Standalone
                          </Badge>
                        )}
                        <p className="font-medium text-sm mt-1">
                          {PAY_CATEGORY_LABELS[item.pay_category] || item.pay_category}
                        </p>
                        {item.pay_type && (
                          <Badge variant="outline" className="text-xs mt-1">
                            {PAY_TYPE_LABELS[item.pay_type] || item.pay_type}
                          </Badge>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="font-bold">{formatCurrency(Number(item.amount))}</p>
                        {item.paid_status === "paid" ? (
                          <Badge className="bg-green-100 text-green-700 hover:bg-green-100 mt-1">
                            Paid
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="bg-orange-100 text-orange-700 hover:bg-orange-100 mt-1">
                            Pending
                          </Badge>
                        )}
                      </div>
                    </div>

                    <div className="space-y-1 text-sm text-muted-foreground">
                      <div className="flex items-center gap-1.5">
                        <Calendar className="h-3.5 w-3.5" />
                        <span>
                          {item.assignment_date
                            ? format(new Date(item.assignment_date + "T00:00:00"), "MM/dd/yyyy")
                            : "—"}
                        </span>
                      </div>
                      {item.description && (
                        <p className="text-xs">{item.description}</p>
                      )}
                      {item.hours && item.rate && (
                        <p className="text-xs">
                          {item.hours}h x ${item.rate}/hr
                        </p>
                      )}
                      {item.paid_at && (
                        <p className="text-xs">
                          Paid on {format(new Date(item.paid_at), "MM/dd/yyyy")}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
