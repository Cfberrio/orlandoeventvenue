import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  CalendarDays, 
  DollarSign, 
  AlertTriangle, 
  TrendingUp,
  Clock,
  Users
} from "lucide-react";
import { 
  useTodaysBookings, 
  useUpcomingBookings, 
  useWeeklyRevenue, 
  usePipelineSummary,
  useOperationalAlerts 
} from "@/hooks/useAdminData";
import { format } from "date-fns";

const lifecycleColors: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  confirmed: "bg-primary/10 text-primary",
  pre_event_ready: "bg-chart-1/20 text-chart-5",
  in_progress: "bg-chart-2/20 text-chart-5",
  post_event: "bg-chart-3/20 text-chart-5",
  closed_review_complete: "bg-chart-4/20 text-foreground",
  cancelled: "bg-destructive/10 text-destructive",
};

export default function AdminDashboard() {
  const { data: todaysBookings, isLoading: loadingToday } = useTodaysBookings();
  const { data: upcomingBookings, isLoading: loadingUpcoming } = useUpcomingBookings(5);
  const { data: weeklyRevenue, isLoading: loadingRevenue } = useWeeklyRevenue();
  const { data: pipeline, isLoading: loadingPipeline } = usePipelineSummary();
  const { data: alerts, isLoading: loadingAlerts } = useOperationalAlerts();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
      
      {/* Top Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Today's Bookings</CardTitle>
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {loadingToday ? "..." : todaysBookings?.length || 0}
            </div>
            <p className="text-xs text-muted-foreground">events scheduled today</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">This Week Revenue</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {loadingRevenue ? "..." : `$${weeklyRevenue?.total.toLocaleString() || 0}`}
            </div>
            <p className="text-xs text-muted-foreground">
              {weeklyRevenue?.count || 0} bookings this week
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pipeline Total</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {loadingPipeline ? "..." : Object.values(pipeline || {}).reduce((a, b) => a + b, 0)}
            </div>
            <p className="text-xs text-muted-foreground">total active bookings</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Alerts</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">
              {loadingAlerts ? "..." : alerts?.length || 0}
            </div>
            <p className="text-xs text-muted-foreground">need attention (next 3 days)</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Upcoming Bookings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Upcoming Bookings
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loadingUpcoming ? (
              <p className="text-muted-foreground">Loading...</p>
            ) : upcomingBookings?.length === 0 ? (
              <p className="text-muted-foreground">No upcoming bookings</p>
            ) : (
              <div className="space-y-3">
                {upcomingBookings?.map((booking) => (
                  <Link
                    key={booking.id}
                    to={`/admin/bookings/${booking.id}`}
                    className="block p-3 rounded-lg border border-border hover:bg-accent/50 transition-colors"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-medium text-foreground">{booking.full_name}</p>
                        <p className="text-sm text-muted-foreground">
                          {format(new Date(booking.event_date), "MMM d, yyyy")}
                          {booking.start_time && ` at ${booking.start_time.slice(0, 5)}`}
                        </p>
                        <p className="text-sm text-muted-foreground">{booking.event_type}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-medium">${Number(booking.total_amount).toLocaleString()}</p>
                        <Badge className={lifecycleColors[booking.lifecycle_status] || "bg-muted"}>
                          {booking.lifecycle_status}
                        </Badge>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
            <Link 
              to="/admin/bookings" 
              className="block mt-4 text-sm text-primary hover:underline"
            >
              View all bookings →
            </Link>
          </CardContent>
        </Card>

        {/* Pipeline Summary */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Pipeline Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loadingPipeline ? (
              <p className="text-muted-foreground">Loading...</p>
            ) : (
              <div className="space-y-3">
                {["pending", "confirmed", "pre_event_ready", "in_progress", "post_event", "closed_review_complete", "cancelled"].map((status) => (
                  <div key={status} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge className={lifecycleColors[status]}>{status.replace(/_/g, " ")}</Badge>
                    </div>
                    <span className="font-medium">{pipeline?.[status] || 0}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Operational Alerts */}
      {alerts && alerts.length > 0 && (
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Operational Alerts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {alerts.slice(0, 5).map((booking) => (
                <Link
                  key={booking.id}
                  to={`/admin/bookings/${booking.id}`}
                  className="block p-3 rounded-lg border border-destructive/30 hover:bg-destructive/5 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">{booking.full_name}</p>
                      <p className="text-sm text-muted-foreground">
                        {format(new Date(booking.event_date), "MMM d, yyyy")} - {booking.event_type}
                      </p>
                    </div>
                    <Badge variant="destructive">Not Ready</Badge>
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
