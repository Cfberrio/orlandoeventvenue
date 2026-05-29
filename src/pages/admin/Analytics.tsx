import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Users,
  UserPlus,
  TrendingUp,
  DollarSign,
  Eye,
  Mail,
  MailCheck,
} from "lucide-react";
import { usePopupAnalytics } from "@/hooks/useAdminData";
import { format, startOfMonth, startOfWeek, subMonths, isAfter, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
} from "recharts";

const FUNNEL_COLORS = ["#14ADE6", "#3B82F6", "#6366F1", "#8B5CF6", "#10B981"];
const ITEMS_PER_PAGE = 25;

type TimeGrouping = "week" | "month";

export default function Analytics() {
  const { data, isLoading } = usePopupAnalytics();
  const [timeGrouping, setTimeGrouping] = useState<TimeGrouping>("week");
  const [currentPage, setCurrentPage] = useState(0);

  const leads = data?.leads ?? [];
  const discountBookings = data?.bookings ?? [];

  const leadEmails = useMemo(() => new Set(leads.map((l) => l.email.toLowerCase())), [leads]);

  const convertedBookings = useMemo(() => {
    return discountBookings.filter(
      (b) => leadEmails.has(b.email.toLowerCase())
    );
  }, [discountBookings, leadEmails]);

  const convertedEmailSet = useMemo(
    () => new Set(convertedBookings.map((b) => b.email.toLowerCase())),
    [convertedBookings]
  );

  const bookingByEmail = useMemo(() => {
    const map = new Map<string, { id: string; reservation_number: string | null }>();
    for (const b of convertedBookings) {
      map.set(b.email.toLowerCase(), { id: b.id, reservation_number: b.reservation_number });
    }
    return map;
  }, [convertedBookings]);

  // --- Top Stats ---
  const totalLeads = leads.length;

  const leadsThisMonth = useMemo(() => {
    const monthStart = startOfMonth(new Date());
    return leads.filter(
      (l) => l.created_at && isAfter(parseISO(l.created_at), monthStart)
    ).length;
  }, [leads]);

  const conversionRate = totalLeads > 0
    ? ((convertedBookings.length / totalLeads) * 100).toFixed(1)
    : "0.0";

  const revenueFromPopup = useMemo(() => {
    return convertedBookings.reduce(
      (sum, b) => sum + (Number(b.total_amount) || 0),
      0
    );
  }, [convertedBookings]);

  // --- Leads over time ---
  const leadsOverTime = useMemo(() => {
    if (leads.length === 0) return [];

    const buckets = new Map<string, number>();
    const now = new Date();
    const sixMonthsAgo = subMonths(now, 6);

    for (const lead of leads) {
      if (!lead.created_at) continue;
      const date = parseISO(lead.created_at);
      if (!isAfter(date, sixMonthsAgo)) continue;

      const key =
        timeGrouping === "week"
          ? format(startOfWeek(date), "MM/dd")
          : format(startOfMonth(date), "MMM yyyy");
      buckets.set(key, (buckets.get(key) || 0) + 1);
    }

    return Array.from(buckets.entries())
      .map(([label, count]) => ({ label, leads: count }));
  }, [leads, timeGrouping]);

  // --- Conversion funnel ---
  const funnelData = useMemo(() => {
    const email1 = leads.filter((l) => l.email_1_sent_at).length;
    const email2 = leads.filter((l) => l.email_2_sent_at).length;
    const email3 = leads.filter((l) => l.email_3_sent_at).length;
    const booked = convertedBookings.length;

    return [
      { step: "Lead Captured", value: totalLeads },
      { step: "Email 1 Sent", value: email1 },
      { step: "Email 2 Sent", value: email2 },
      { step: "Email 3 Sent", value: email3 },
      { step: "Booked", value: booked },
    ];
  }, [leads, totalLeads, convertedBookings]);

  // --- Pagination ---
  const totalPages = Math.max(1, Math.ceil(leads.length / ITEMS_PER_PAGE));
  const pagedLeads = leads.slice(
    currentPage * ITEMS_PER_PAGE,
    (currentPage + 1) * ITEMS_PER_PAGE
  );

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-foreground">Analytics</h1>
        <div className="p-8 text-center text-muted-foreground">Loading analytics...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-foreground">Analytics</h1>

      {/* Top Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Popup Leads</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalLeads}</div>
            <p className="text-xs text-muted-foreground">All time</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Leads This Month</CardTitle>
            <UserPlus className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{leadsThisMonth}</div>
            <p className="text-xs text-muted-foreground">{format(new Date(), "MMMM yyyy")}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Conversion Rate</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{conversionRate}%</div>
            <p className="text-xs text-muted-foreground">
              {convertedBookings.length} of {totalLeads} leads booked
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Revenue from Popup</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ${revenueFromPopup.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground">
              From {convertedBookings.length} converted bookings
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Leads Over Time */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Leads Over Time</CardTitle>
              <div className="flex gap-1">
                <Button
                  variant={timeGrouping === "week" ? "default" : "outline"}
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setTimeGrouping("week")}
                >
                  Weekly
                </Button>
                <Button
                  variant={timeGrouping === "month" ? "default" : "outline"}
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setTimeGrouping("month")}
                >
                  Monthly
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {leadsOverTime.length === 0 ? (
              <div className="h-[250px] flex items-center justify-center text-muted-foreground text-sm">
                No data available
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={250}>
                <AreaChart data={leadsOverTime}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 12 }}
                    className="fill-muted-foreground"
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 12 }}
                    className="fill-muted-foreground"
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                      fontSize: "13px",
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="leads"
                    stroke="#14ADE6"
                    fill="#14ADE6"
                    fillOpacity={0.15}
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Conversion Funnel */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Conversion Funnel</CardTitle>
          </CardHeader>
          <CardContent>
            {totalLeads === 0 ? (
              <div className="h-[250px] flex items-center justify-center text-muted-foreground text-sm">
                No data available
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={funnelData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis
                    type="number"
                    allowDecimals={false}
                    tick={{ fontSize: 12 }}
                    className="fill-muted-foreground"
                  />
                  <YAxis
                    type="category"
                    dataKey="step"
                    width={100}
                    tick={{ fontSize: 12 }}
                    className="fill-muted-foreground"
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                      fontSize: "13px",
                    }}
                  />
                  <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                    {funnelData.map((_entry, index) => (
                      <Cell key={`cell-${index}`} fill={FUNNEL_COLORS[index % FUNNEL_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Leads Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">
              All Popup Leads
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                ({totalLeads})
              </span>
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Coupon</TableHead>
                  <TableHead className="text-center">Emails Sent</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedLeads.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      No popup leads yet
                    </TableCell>
                  </TableRow>
                ) : (
                  pagedLeads.map((lead) => {
                    const isConverted = convertedEmailSet.has(lead.email.toLowerCase());
                    const linkedBooking = bookingByEmail.get(lead.email.toLowerCase());
                    const emailsSent =
                      (lead.email_1_sent_at ? 1 : 0) +
                      (lead.email_2_sent_at ? 1 : 0) +
                      (lead.email_3_sent_at ? 1 : 0);

                    return (
                      <TableRow key={lead.id}>
                        <TableCell>
                          <div className="text-sm font-medium">
                            {lead.created_at
                              ? format(new Date(lead.created_at), "MM/dd/yyyy")
                              : "—"}
                          </div>
                          {lead.created_at && (
                            <div className="text-xs text-muted-foreground">
                              {format(new Date(lead.created_at), "h:mm a")}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="font-medium">{lead.full_name}</TableCell>
                        <TableCell>
                          <div className="text-sm">{lead.email}</div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {lead.coupon_code || "—"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-center gap-1">
                            {[lead.email_1_sent_at, lead.email_2_sent_at, lead.email_3_sent_at].map(
                              (sentAt, i) => (
                                <div
                                  key={i}
                                  title={
                                    sentAt
                                      ? `Email ${i + 1}: ${format(new Date(sentAt), "MM/dd/yyyy h:mm a")}`
                                      : `Email ${i + 1}: Not sent`
                                  }
                                >
                                  {sentAt ? (
                                    <MailCheck className="h-4 w-4 text-green-600" />
                                  ) : (
                                    <Mail className="h-4 w-4 text-muted-foreground/40" />
                                  )}
                                </div>
                              )
                            )}
                            <span className="ml-1 text-xs text-muted-foreground">
                              {emailsSent}/3
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          {isConverted ? (
                            <Badge className={cn(
                              "text-xs",
                              "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                            )}>
                              Booked
                            </Badge>
                          ) : (
                            <Badge className={cn(
                              "text-xs",
                              "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
                            )}>
                              Lead
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {linkedBooking && (
                            <Link to={`/admin/bookings/${linkedBooking.id}`}>
                              <Button variant="ghost" size="sm" className="h-7">
                                <Eye className="h-4 w-4" />
                              </Button>
                            </Link>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t">
              <span className="text-sm text-muted-foreground">
                Page {currentPage + 1} of {totalPages}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage === 0}
                  onClick={() => setCurrentPage((p) => p - 1)}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage >= totalPages - 1}
                  onClick={() => setCurrentPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
