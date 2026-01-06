import { useState } from "react";
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
import { CalendarIcon, DollarSign, TrendingUp, Users, FileText } from "lucide-react";
import { useReportsData } from "@/hooks/useAdminData";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { Link } from "react-router-dom";

const leadSources = ["direct_site", "instagram", "trustedvenues_directory", "referral", "phone_call"];
const revenueStatuses = ["confirmed", "in_progress", "post_event", "closed_review_complete"];

export default function Reports() {
  const [dateFrom, setDateFrom] = useState<Date>(startOfMonth(new Date()));
  const [dateTo, setDateTo] = useState<Date>(endOfMonth(new Date()));
  const [eventType, setEventType] = useState("");
  const [leadSource, setLeadSource] = useState("");

  const { data: bookings, isLoading } = useReportsData({
    dateFrom: format(dateFrom, "yyyy-MM-dd"),
    dateTo: format(dateTo, "yyyy-MM-dd"),
    eventType: eventType || undefined,
    leadSource: leadSource && leadSource !== "all" ? leadSource : undefined,
    lifecycleStatus: revenueStatuses,
  });

  // Calculate metrics
  const totalBookings = bookings?.length || 0;
  const totalRevenue = bookings?.reduce((sum, b) => sum + Number(b.total_amount || 0), 0) || 0;
  const avgBookingValue = totalBookings > 0 ? totalRevenue / totalBookings : 0;

  // Group by event type
  const byEventType: Record<string, { count: number; revenue: number }> = {};
  bookings?.forEach((b) => {
    const type = b.event_type || "Unknown";
    if (!byEventType[type]) byEventType[type] = { count: 0, revenue: 0 };
    byEventType[type].count++;
    byEventType[type].revenue += Number(b.total_amount || 0);
  });

  // Group by lead source
  const byLeadSource: Record<string, { count: number; revenue: number }> = {};
  bookings?.forEach((b) => {
    const source = b.lead_source || "Unknown";
    if (!byLeadSource[source]) byLeadSource[source] = { count: 0, revenue: 0 };
    byLeadSource[source].count++;
    byLeadSource[source].revenue += Number(b.total_amount || 0);
  });

  // Top clients
  const clientTotals: Record<string, { name: string; email: string; total: number; count: number }> = {};
  bookings?.forEach((b) => {
    const key = b.email;
    if (!clientTotals[key]) {
      clientTotals[key] = { name: b.full_name, email: b.email, total: 0, count: 0 };
    }
    clientTotals[key].total += Number(b.total_amount || 0);
    clientTotals[key].count++;
  });
  const topClients = Object.values(clientTotals)
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-foreground">Sales & Performance Reports</h1>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="text-sm font-medium mb-1 block">Date From</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start text-left">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {format(dateFrom, "PP")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={dateFrom}
                    onSelect={(d) => d && setDateFrom(d)}
                    className="pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Date To</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start text-left">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {format(dateTo, "PP")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={dateTo}
                    onSelect={(d) => d && setDateTo(d)}
                    className="pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Event Type</label>
              <Input
                placeholder="Filter by type..."
                value={eventType}
                onChange={(e) => setEventType(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Lead Source</label>
              <Select value={leadSource} onValueChange={setLeadSource}>
                <SelectTrigger>
                  <SelectValue placeholder="All sources" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All sources</SelectItem>
                  {leadSources.map((source) => (
                    <SelectItem key={source} value={source}>
                      {source.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Bookings</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{isLoading ? "..." : totalBookings}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{isLoading ? "..." : `$${totalRevenue.toLocaleString()}`}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Booking Value</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{isLoading ? "..." : `$${avgBookingValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* By Event Type */}
        <Card>
          <CardHeader>
            <CardTitle>By Event Type</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-muted-foreground">Loading...</p>
            ) : Object.keys(byEventType).length === 0 ? (
              <p className="text-muted-foreground">No data</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Event Type</TableHead>
                    <TableHead className="text-right">Count</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Object.entries(byEventType)
                    .sort((a, b) => b[1].revenue - a[1].revenue)
                    .map(([type, data]) => (
                      <TableRow key={type}>
                        <TableCell>{type}</TableCell>
                        <TableCell className="text-right">{data.count}</TableCell>
                        <TableCell className="text-right">${data.revenue.toLocaleString()}</TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* By Lead Source */}
        <Card>
          <CardHeader>
            <CardTitle>By Lead Source</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-muted-foreground">Loading...</p>
            ) : Object.keys(byLeadSource).length === 0 ? (
              <p className="text-muted-foreground">No data</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Source</TableHead>
                    <TableHead className="text-right">Count</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Object.entries(byLeadSource)
                    .sort((a, b) => b[1].revenue - a[1].revenue)
                    .map(([source, data]) => (
                      <TableRow key={source}>
                        <TableCell>{source.replace(/_/g, " ")}</TableCell>
                        <TableCell className="text-right">{data.count}</TableCell>
                        <TableCell className="text-right">${data.revenue.toLocaleString()}</TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Top Clients */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Top Clients (by total spent)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground">Loading...</p>
          ) : topClients.length === 0 ? (
            <p className="text-muted-foreground">No data</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead className="text-right">Bookings</TableHead>
                  <TableHead className="text-right">Total Spent</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topClients.map((client, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{client.name}</TableCell>
                    <TableCell>{client.email}</TableCell>
                    <TableCell className="text-right">{client.count}</TableCell>
                    <TableCell className="text-right font-medium">${client.total.toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Bookings in Range */}
      <Card>
        <CardHeader>
          <CardTitle>Bookings in Range</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground">Loading...</p>
          ) : bookings?.length === 0 ? (
            <p className="text-muted-foreground">No bookings found</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Event Type</TableHead>
                    <TableHead>Guests</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Payment</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bookings?.map((booking) => (
                    <TableRow key={booking.id}>
                      <TableCell>
                        <Link to={`/admin/bookings/${booking.id}`} className="hover:underline">
                          {format(new Date(booking.event_date + 'T00:00:00'), "MMM d")}
                        </Link>
                      </TableCell>
                      <TableCell className="font-medium">
                        <Link to={`/admin/bookings/${booking.id}`} className="hover:underline">
                          {booking.full_name}
                        </Link>
                      </TableCell>
                      <TableCell>{booking.event_type}</TableCell>
                      <TableCell>{booking.number_of_guests}</TableCell>
                      <TableCell>{booking.lead_source?.replace(/_/g, " ") || "-"}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{booking.payment_status}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{booking.lifecycle_status}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        ${Number(booking.total_amount).toLocaleString()}
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
