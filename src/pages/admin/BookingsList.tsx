import { useState } from "react";
import { Link } from "react-router-dom";
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
import { CalendarIcon, Filter, X, Eye } from "lucide-react";
import { useBookings } from "@/hooks/useAdminData";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

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
  const [showFilters, setShowFilters] = useState(false);

  const { data: bookings, isLoading } = useBookings({
    dateFrom: dateFrom ? format(dateFrom, "yyyy-MM-dd") : undefined,
    dateTo: dateTo ? format(dateTo, "yyyy-MM-dd") : undefined,
    lifecycleStatus: lifecycleStatus && lifecycleStatus !== "all" ? [lifecycleStatus] : undefined,
    paymentStatus: paymentStatus && paymentStatus !== "all" ? paymentStatus : undefined,
    eventType: eventType || undefined,
  });

  const clearFilters = () => {
    setDateFrom(undefined);
    setDateTo(undefined);
    setLifecycleStatus("");
    setPaymentStatus("");
    setEventType("");
  };

  const hasFilters = dateFrom || dateTo || (lifecycleStatus && lifecycleStatus !== "all") || (paymentStatus && paymentStatus !== "all") || eventType;

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
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              {/* Date From */}
              <div>
                <label className="text-sm font-medium mb-1 block">Date From</label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start text-left">
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {dateFrom ? format(dateFrom, "PP") : "Select"}
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

              {/* Date To */}
              <div>
                <label className="text-sm font-medium mb-1 block">Date To</label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start text-left">
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {dateTo ? format(dateTo, "PP") : "Select"}
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
            </div>
          </CardContent>
        </Card>
      )}

      {/* Bookings Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Loading bookings...</div>
          ) : bookings?.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">No bookings found</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead>Guests</TableHead>
                    <TableHead>Payment</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Deposit Paid</TableHead>
                    <TableHead>Balance Paid</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bookings?.map((booking) => {
                    const lifecycle = lifecycleConfig[booking.lifecycle_status] || { label: booking.lifecycle_status, color: "bg-muted" };
                    const payment = paymentConfig[booking.payment_status] || { label: booking.payment_status, color: "bg-muted" };
                    
                    return (
                      <TableRow key={booking.id} className="group">
                        <TableCell>
                          <div className="font-medium">{format(new Date(booking.event_date + 'T00:00:00'), "MMM d, yyyy")}</div>
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
                          <Badge className={cn("text-xs", payment.color)}>
                            {payment.label}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge className={cn("text-xs", lifecycle.color)}>
                            {lifecycle.label}
                          </Badge>
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}
