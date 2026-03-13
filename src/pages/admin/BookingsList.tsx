import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon, Filter, X, Eye, AlertTriangle, RefreshCw } from "lucide-react";
import { useBookings } from "@/hooks/useAdminData";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

interface RecurringInvoice {
  id: string;
  invoice_number: string;
  title: string;
  description: string | null;
  amount: number;
  customer_email: string;
  customer_name: string | null;
  payment_status: string;
  created_at: string;
  is_recurring: boolean;
  recurring_active: boolean;
  recurring_interval_days: number | null;
  recurring_next_send_at: string | null;
  recurring_parent_id: string | null;
}

function frequencyLabel(days: number | null): string {
  if (!days) return "";
  if (days === 7) return "Weekly";
  if (days === 14) return "Bi-weekly";
  if (days === 30) return "Monthly";
  return `Every ${days}d`;
}

const lifecycleStatuses = [
  "pending",
  "confirmed",
  "pre_event_ready",
  "in_progress",
  "post_event",
  "closed_review_complete",
  "cancelled",
];

const paymentStatuses = ["pending", "deposit_paid", "fully_paid", "failed", "refunded", "invoiced"];

const lifecycleConfig: Record<string, { label: string; color: string }> = {
  pending: { 
    label: "Pending Review", 
    color: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
  },
  confirmed: { 
    label: "Confirmed", 
    color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400"
  },
  pre_event_ready: { 
    label: "Pre-Event Ready", 
    color: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400"
  },
  in_progress: { 
    label: "In Progress", 
    color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
  },
  post_event: { 
    label: "Post-Event", 
    color: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400"
  },
  closed_review_complete: { 
    label: "Closed", 
    color: "bg-slate-100 text-slate-800 dark:bg-slate-900/30 dark:text-slate-400"
  },
  cancelled: { 
    label: "Cancelled", 
    color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
  },
};

const paymentConfig: Record<string, { label: string; color: string }> = {
  pending: { label: "Pending", color: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400" },
  deposit_paid: { label: "Deposit Paid", color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400" },
  fully_paid: { label: "Paid", color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" },
  failed: { label: "Failed", color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400" },
  refunded: { label: "Refunded", color: "bg-slate-100 text-slate-800 dark:bg-slate-900/30 dark:text-slate-400" },
  invoiced: { label: "Invoiced", color: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400" },
};

export default function BookingsList() {
  const [dateFrom, setDateFrom] = useState<Date | undefined>();
  const [dateTo, setDateTo] = useState<Date | undefined>();
  const [lifecycleStatus, setLifecycleStatus] = useState<string>("");
  const [paymentStatus, setPaymentStatus] = useState<string>("");
  const [eventType, setEventType] = useState<string>("");
  const [clientName, setClientName] = useState<string>("");
  const [sortBy, setSortBy] = useState<'created_at' | 'full_name'>('created_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [showFilters, setShowFilters] = useState(false);

  const { data: bookings, isLoading } = useBookings({
    dateFrom: dateFrom ? format(dateFrom, "yyyy-MM-dd") : undefined,
    dateTo: dateTo ? format(dateTo, "yyyy-MM-dd") : undefined,
    lifecycleStatus: lifecycleStatus && lifecycleStatus !== "all" ? [lifecycleStatus] : undefined,
    paymentStatus: paymentStatus && paymentStatus !== "all" ? paymentStatus : undefined,
    eventType: eventType || undefined,
    clientName: clientName || undefined,
    sortBy,
    sortOrder,
  });

  // Group bookings by lifecycle_status
  const groupedBookings = useMemo(() => {
    if (!bookings) return {};
    
    const groups: Record<string, typeof bookings> = {};
    
    // Initialize all status with empty arrays
    lifecycleStatuses.forEach(status => {
      groups[status] = [];
    });
    
    // Group bookings (exclude internal bookings from lifecycle groups)
    bookings.forEach(booking => {
      if (booking.booking_origin === "internal") return;
      const status = booking.lifecycle_status || 'pending';
      if (groups[status]) {
        groups[status].push(booking);
      }
    });
    
    return groups;
  }, [bookings]);

  const internalBookings = useMemo(() => {
    if (!bookings) return [];
    return bookings.filter(b => b.booking_origin === "internal");
  }, [bookings]);

  const { data: recurringInvoices } = useQuery({
    queryKey: ["recurring-invoices-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices" as any)
        .select("*")
        .eq("is_recurring", true)
        .eq("recurring_active", true)
        .is("recurring_parent_id", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as RecurringInvoice[];
    },
  });

  const renderRecurringInvoicesTable = (invoicesList: RecurringInvoice[]) => (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Invoice #</TableHead>
            <TableHead>Customer</TableHead>
            <TableHead>Title</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead>Frequency</TableHead>
            <TableHead>Next Send</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {invoicesList.map((invoice) => (
            <TableRow key={invoice.id} className="group">
              <TableCell>
                <div className="text-sm font-medium">{invoice.invoice_number}</div>
                <div className="text-xs text-muted-foreground">
                  {format(new Date(invoice.created_at), "MM/dd/yyyy")}
                </div>
              </TableCell>
              <TableCell>
                <div className="font-medium">{invoice.customer_name || "—"}</div>
                <div className="text-xs text-muted-foreground">{invoice.customer_email}</div>
              </TableCell>
              <TableCell>
                <div className="text-sm">{invoice.title}</div>
                {invoice.description && (
                  <div className="text-xs text-muted-foreground truncate max-w-[180px]">
                    {invoice.description}
                  </div>
                )}
              </TableCell>
              <TableCell className="text-right font-medium">
                ${Number(invoice.amount).toLocaleString()}
              </TableCell>
              <TableCell>
                <Badge className="text-xs bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400">
                  <RefreshCw className="h-3 w-3 mr-1" />
                  {frequencyLabel(invoice.recurring_interval_days)}
                </Badge>
              </TableCell>
              <TableCell>
                <div className="text-sm">
                  {invoice.recurring_next_send_at
                    ? format(new Date(invoice.recurring_next_send_at), "MM/dd/yyyy")
                    : <span className="text-muted-foreground">—</span>
                  }
                </div>
              </TableCell>
              <TableCell>
                <Badge className={cn(
                  "text-xs",
                  invoice.recurring_active
                    ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                    : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                )}>
                  {invoice.recurring_active ? "Active" : "Paused"}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );

  const clearFilters = () => {
    setDateFrom(undefined);
    setDateTo(undefined);
    setLifecycleStatus("");
    setPaymentStatus("");
    setEventType("");
    setClientName("");
    setSortBy('created_at');
    setSortOrder('desc');
  };

  const hasFilters = dateFrom || dateTo || 
    (lifecycleStatus && lifecycleStatus !== "all") || 
    (paymentStatus && paymentStatus !== "all") || 
    eventType || 
    clientName ||
    sortBy !== 'created_at' ||
    sortOrder !== 'desc';

  const renderBookingsTable = (bookingsList: NonNullable<typeof bookings>, isLeadGroup: boolean) => (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Booked On</TableHead>
            <TableHead>Event Date</TableHead>
            <TableHead>Client</TableHead>
            <TableHead>Event</TableHead>
            <TableHead>Guests</TableHead>
            <TableHead>Payment</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead>Deposit Paid</TableHead>
            <TableHead>Balance Paid</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {bookingsList.map((booking) => {
            const payment = paymentConfig[booking.payment_status] || { 
              label: booking.payment_status, 
              color: "bg-muted" 
            };
            
            return (
              <TableRow key={booking.id} className={cn("group", isLeadGroup && "bg-red-50/50 dark:bg-red-950/10")}>
                <TableCell>
                  <div className="text-sm font-medium">
                    {format(new Date(booking.created_at), "MM/dd/yyyy")}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {format(new Date(booking.created_at), "h:mm a")}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="font-medium">
                    {format(new Date(booking.event_date + 'T00:00:00'), "MM/dd/yyyy")}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {booking.start_time?.slice(0, 5) || "All day"}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="font-medium">{booking.full_name}</div>
                  <div className="text-xs text-muted-foreground">{booking.email}</div>
                </TableCell>
                <TableCell>
                  <div>{booking.event_type}</div>
                  <div className="text-xs text-muted-foreground">{booking.booking_type}</div>
                </TableCell>
                <TableCell>{booking.number_of_guests}</TableCell>
                <TableCell>
                  <div className="flex flex-col gap-1">
                    <Badge className={cn("text-xs", payment.color)}>
                      {payment.label}
                    </Badge>
                    {isLeadGroup && (
                      <Badge className="text-xs bg-red-600 text-white dark:bg-red-700">
                        LEAD
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-right font-medium">
                  ${Number(booking.total_amount).toLocaleString()}
                </TableCell>
                <TableCell>
                  <div className="text-sm">
                    {booking.deposit_paid_at 
                      ? format(new Date(booking.deposit_paid_at), "MM/dd/yyyy")
                      : <span className="text-muted-foreground">Pending</span>
                    }
                  </div>
                </TableCell>
                <TableCell>
                  <div className="text-sm">
                    {booking.balance_paid_at 
                      ? format(new Date(booking.balance_paid_at), "MM/dd/yyyy")
                      : <span className="text-muted-foreground">Pending</span>
                    }
                  </div>
                </TableCell>
                <TableCell>
                  <Link to={`/admin/bookings/${booking.id}`}>
                    <Button variant="ghost" size="sm" className="h-7">
                      <Eye className="h-4 w-4" />
                    </Button>
                  </Link>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Bookings</h1>
        <Button variant="outline" onClick={() => setShowFilters(!showFilters)}>
          <Filter className="h-4 w-4 mr-2" />
          Filters
          {hasFilters && <Badge className="ml-2 bg-primary">Active</Badge>}
        </Button>
      </div>

      {/* Filters */}
      {showFilters && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Filters</CardTitle>
              {hasFilters && (
                <Button variant="ghost" size="sm" onClick={clearFilters}>
                  <X className="h-4 w-4 mr-1" />
                  Clear all
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-4">
              {/* Booked From */}
              <div>
                <label className="text-sm font-medium mb-1 block">Booked From</label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start text-left">
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {dateFrom ? format(dateFrom, "MM/dd/yyyy") : "Select"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={dateFrom}
                      onSelect={setDateFrom}
                      className="pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>
              </div>

              {/* Booked To */}
              <div>
                <label className="text-sm font-medium mb-1 block">Booked To</label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start text-left">
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {dateTo ? format(dateTo, "MM/dd/yyyy") : "Select"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={dateTo}
                      onSelect={setDateTo}
                      className="pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>
              </div>

              {/* Lifecycle Status */}
              <div>
                <label className="text-sm font-medium mb-1 block">Lifecycle Status</label>
                <Select value={lifecycleStatus} onValueChange={setLifecycleStatus}>
                  <SelectTrigger>
                    <SelectValue placeholder="All statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    {lifecycleStatuses.map((status) => (
                      <SelectItem key={status} value={status}>
                        {lifecycleConfig[status]?.label || status}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Payment Status */}
              <div>
                <label className="text-sm font-medium mb-1 block">Payment Status</label>
                <Select value={paymentStatus} onValueChange={setPaymentStatus}>
                  <SelectTrigger>
                    <SelectValue placeholder="All" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    {paymentStatuses.map((status) => (
                      <SelectItem key={status} value={status}>
                        {paymentConfig[status]?.label || status}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Event Type */}
              <div>
                <label className="text-sm font-medium mb-1 block">Event Type</label>
                <Input
                  placeholder="Filter by type..."
                  value={eventType}
                  onChange={(e) => setEventType(e.target.value)}
                />
              </div>

              {/* Client Name Search */}
              <div>
                <label className="text-sm font-medium mb-1 block">Client Name</label>
                <Input
                  placeholder="Search by client name..."
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                />
              </div>

              {/* Sort By */}
              <div>
                <label className="text-sm font-medium mb-1 block">Sort By</label>
                <Select value={sortBy} onValueChange={(value) => setSortBy(value as 'created_at' | 'full_name')}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="created_at">Booking Date</SelectItem>
                    <SelectItem value="full_name">Client Name</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Sort Order */}
              <div>
                <label className="text-sm font-medium mb-1 block">Order</label>
                <Select value={sortOrder} onValueChange={(value) => setSortOrder(value as 'asc' | 'desc')}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="desc">
                      {sortBy === 'created_at' ? 'Most Recent First' : 'Z to A'}
                    </SelectItem>
                    <SelectItem value="asc">
                      {sortBy === 'created_at' ? 'Oldest First' : 'A to Z'}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Bookings Grouped by Status */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Loading bookings...</div>
          ) : bookings?.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">No bookings found</div>
          ) : (
            <div className="space-y-6 p-6">
              {lifecycleStatuses.map((status) => {
                const statusBookings = groupedBookings[status] || [];
                const statusConfig = lifecycleConfig[status];
                
                // Skip if no bookings for this status
                if (statusBookings.length === 0) return null;

                // For "pending" status, split into Leads (no deposit) and Pending Review (deposit paid)
                if (status === "pending") {
                  const leadBookings = statusBookings.filter(b => b.payment_status === "pending");
                  const paidPendingBookings = statusBookings.filter(b => b.payment_status !== "pending");

                  return (
                    <div key={status} className="space-y-6">
                      {/* Leads Sub-group */}
                      {leadBookings.length > 0 && (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between border-b pb-2">
                            <div className="flex items-center gap-3">
                              <Badge className="text-sm bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
                                <AlertTriangle className="h-3.5 w-3.5 mr-1.5" />
                                Leads - No Deposit
                              </Badge>
                              <span className="text-sm text-muted-foreground">
                                {leadBookings.length} {leadBookings.length === 1 ? 'lead' : 'leads'}
                              </span>
                            </div>
                          </div>
                          {renderBookingsTable(leadBookings, true)}
                        </div>
                      )}

                      {/* Paid Pending Review Sub-group */}
                      {paidPendingBookings.length > 0 && (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between border-b pb-2">
                            <div className="flex items-center gap-3">
                              <Badge className={cn("text-sm", statusConfig.color)}>
                                {statusConfig.label}
                              </Badge>
                              <span className="text-sm text-muted-foreground">
                                {paidPendingBookings.length} {paidPendingBookings.length === 1 ? 'booking' : 'bookings'}
                              </span>
                            </div>
                          </div>
                          {renderBookingsTable(paidPendingBookings, false)}
                        </div>
                      )}
                    </div>
                  );
                }
                
                return (
                  <div key={status} className="space-y-3">
                    {/* Status Header with Counter */}
                    <div className="flex items-center justify-between border-b pb-2">
                      <div className="flex items-center gap-3">
                        <Badge className={cn("text-sm", statusConfig.color)}>
                          {statusConfig.label}
                        </Badge>
                        <span className="text-sm text-muted-foreground">
                          {statusBookings.length} {statusBookings.length === 1 ? 'booking' : 'bookings'}
                        </span>
                      </div>
                    </div>
                    {renderBookingsTable(statusBookings, false)}
                  </div>
                );
              })}

              {/* Internal bookings section */}
              {internalBookings.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between border-b pb-2">
                    <div className="flex items-center gap-3">
                      <Badge className="text-sm bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        Internal
                      </Badge>
                      <span className="text-sm text-muted-foreground">
                        {internalBookings.length} {internalBookings.length === 1 ? 'booking' : 'bookings'}
                      </span>
                    </div>
                  </div>
                  {renderBookingsTable(internalBookings, false)}
                </div>
              )}

              {/* Recurring / Internal Invoices section */}
              {recurringInvoices && recurringInvoices.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between border-b pb-2">
                    <div className="flex items-center gap-3">
                      <Badge className="text-sm bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400">
                        <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                        Internal Invoices
                      </Badge>
                      <span className="text-sm text-muted-foreground">
                        {recurringInvoices.length} {recurringInvoices.length === 1 ? 'active invoice' : 'active invoices'}
                      </span>
                    </div>
                  </div>
                  {renderRecurringInvoicesTable(recurringInvoices)}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
