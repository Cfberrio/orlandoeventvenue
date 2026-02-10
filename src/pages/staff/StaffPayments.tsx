import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
import {
  DollarSign,
  Download,
  Calendar,
  Filter,
  CheckCircle2,
  Clock,
  FileText,
} from "lucide-react";
import { useStaffSession } from "@/hooks/useStaffSession";
import { useStaffPayrollData } from "@/hooks/useStaffPayrollData";
import { PayrollLineItem } from "@/hooks/usePayrollData";
import { format, startOfMonth, endOfMonth } from "date-fns";
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
  const [typeFilter, setTypeFilter] = useState<"all" | "cleaning" | "production">("all");
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

    if (typeFilter !== "all") {
      if (typeFilter === "cleaning") {
        items = items.filter(
          (item) =>
            item.pay_category === "cleaning_base" ||
            item.pay_category === "cleaning_surcharge"
        );
      } else if (typeFilter === "production") {
        items = items.filter(
          (item) => item.pay_category === "hourly_production"
        );
      }
    }

    if (statusFilter !== "all") {
      items = items.filter((item) => item.paid_status === statusFilter);
    }

    return items;
  }, [lineItems, typeFilter, statusFilter]);

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
          assignmentType: typeFilter,
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
            View your payment history, pending amounts, and assignment details
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-1 block">From</label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-1 block">To</label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-1 block">Assignment Type</label>
              <Select value={typeFilter} onValueChange={(value) => setTypeFilter(value as "all" | "cleaning" | "production")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="cleaning">Cleaning</SelectItem>
                  <SelectItem value="production">Production</SelectItem>
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
                Try adjusting the date range or filters
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
                      <TableHead>Category</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Booking</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredItems.map((item) => (
                      <TableRow key={item.payroll_item_id}>
                        <TableCell className="whitespace-nowrap">
                          {item.assignment_date
                            ? format(new Date(item.assignment_date + "T00:00:00"), "MMM d, yyyy")
                            : "—"}
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
                        <TableCell>
                          {item.reservation_number ? (
                            <Badge variant="secondary" className="text-xs">
                              {item.reservation_number}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">Standalone</span>
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
                              {format(new Date(item.paid_at), "MMM d")}
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
                        <p className="font-medium text-sm">
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
                            ? format(new Date(item.assignment_date + "T00:00:00"), "MMM d, yyyy")
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
                      <div className="flex items-center gap-1.5">
                        <FileText className="h-3.5 w-3.5" />
                        <span>
                          {item.reservation_number
                            ? `Booking ${item.reservation_number}`
                            : "Standalone Assignment"}
                        </span>
                      </div>
                      {item.paid_at && (
                        <p className="text-xs">
                          Paid on {format(new Date(item.paid_at), "MMM d, yyyy")}
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
