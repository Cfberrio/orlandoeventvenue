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
import { CalendarIcon, Filter, X } from "lucide-react";
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

const lifecycleColors: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  confirmed: "bg-primary/10 text-primary",
  pre_event_ready: "bg-chart-1/20 text-chart-5",
  in_progress: "bg-chart-2/20 text-chart-5",
  post_event: "bg-chart-3/20 text-chart-5",
  closed_review_complete: "bg-chart-4/20 text-foreground",
  cancelled: "bg-destructive/10 text-destructive",
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
    lifecycleStatus: lifecycleStatus ? [lifecycleStatus] : undefined,
    paymentStatus: paymentStatus || undefined,
    eventType: eventType || undefined,
  });

  const clearFilters = () => {
    setDateFrom(undefined);
    setDateTo(undefined);
    setLifecycleStatus("");
    setPaymentStatus("");
    setEventType("");
  };

  const hasFilters = dateFrom || dateTo || lifecycleStatus || paymentStatus || eventType;

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
                    <SelectItem value="">All statuses</SelectItem>
                    {lifecycleStatuses.map((status) => (
                      <SelectItem key={status} value={status}>
                        {status.replace(/_/g, " ")}
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
                    <SelectItem value="">All</SelectItem>
                    {paymentStatuses.map((status) => (
                      <SelectItem key={status} value={status}>
                        {status.replace(/_/g, " ")}
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
                    <TableHead>Time</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Event Type</TableHead>
                    <TableHead>Guests</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Payment</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bookings?.map((booking) => (
                    <TableRow key={booking.id} className="cursor-pointer hover:bg-accent/50">
                      <TableCell>
                        <Link to={`/admin/bookings/${booking.id}`} className="block">
                          {format(new Date(booking.event_date), "MMM d, yyyy")}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Link to={`/admin/bookings/${booking.id}`} className="block">
                          {booking.start_time?.slice(0, 5) || "-"} - {booking.end_time?.slice(0, 5) || "-"}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Link to={`/admin/bookings/${booking.id}`} className="block font-medium">
                          {booking.full_name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Link to={`/admin/bookings/${booking.id}`} className="block">
                          {booking.event_type}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Link to={`/admin/bookings/${booking.id}`} className="block">
                          {booking.number_of_guests}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Link to={`/admin/bookings/${booking.id}`} className="block">
                          <Badge variant="outline">{booking.booking_type}</Badge>
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Link to={`/admin/bookings/${booking.id}`} className="block">
                          <Badge variant="secondary">{booking.payment_status}</Badge>
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Link to={`/admin/bookings/${booking.id}`} className="block">
                          <Badge className={lifecycleColors[booking.lifecycle_status] || "bg-muted"}>
                            {booking.lifecycle_status.replace(/_/g, " ")}
                          </Badge>
                        </Link>
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        <Link to={`/admin/bookings/${booking.id}`} className="block">
                          ${Number(booking.total_amount).toLocaleString()}
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
