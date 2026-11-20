import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { 
  CalendarDays, 
  DollarSign, 
  AlertTriangle, 
  TrendingUp,
  Clock,
  Users,
  Wrench,
  MessageSquareWarning,
  UserMinus,
  CheckCircle
} from "lucide-react";
import { 
  useTodaysBookings, 
  useUpcomingBookings, 
  useWeeklyRevenue, 
  usePipelineSummary,
  useOperationalAlerts,
  useIssueAlerts,
  useStaffUnassignmentAlerts,
  useResolveStaffUnassignmentAlert,
  useResolveIssueAlert
} from "@/hooks/useAdminData";
import { useExternalSetupAlerts, useRetryExternalSetup } from "@/hooks/useExternalSetupAlerts";
import { AUTO_RETRY_STEPS, EXTERNAL_SETUP_LABELS } from "@/lib/externalSetup";
import { format } from "date-fns";
import AccessCodeAdminCard from "@/components/admin/AccessCodeAdminCard";
import RecurringAccessCodesCard from "@/components/admin/RecurringAccessCodesCard";
import { eventTypeLabel } from "@/lib/eventTypes";
import { lifecycleLabel } from "@/lib/statusLabels";
import { formatMoney } from "@/lib/paymentSummary";

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
  const { toast } = useToast();
  const { data: todaysBookings, isLoading: loadingToday } = useTodaysBookings();
  const { data: upcomingBookings, isLoading: loadingUpcoming } = useUpcomingBookings(5);
  const { data: weeklyRevenue, isLoading: loadingRevenue } = useWeeklyRevenue();
  const { data: pipeline, isLoading: loadingPipeline } = usePipelineSummary();
  const { data: alerts, isLoading: loadingAlerts } = useOperationalAlerts();
  const { data: issueAlerts, isLoading: loadingIssueAlerts } = useIssueAlerts();
  const { data: staffUnassignmentAlerts, isLoading: loadingStaffUnassignments } = useStaffUnassignmentAlerts();
  const resolveAlert = useResolveStaffUnassignmentAlert();
  const resolveIssue = useResolveIssueAlert();
  const { data: externalSetupAlerts } = useExternalSetupAlerts();
  const retryExternalSetup = useRetryExternalSetup();

  const totalAlerts = (alerts?.length || 0) + (issueAlerts?.length || 0) + (staffUnassignmentAlerts?.length || 0) + (externalSetupAlerts?.length || 0);

  const handleResolveIssue = async (kind: "cleaning" | "guest", reportId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await resolveIssue.mutateAsync({ kind, reportId });
      toast({ title: "Issue resolved", description: "It is recorded on the booking's history." });
    } catch (error) {
      toast({
        title: "Could not resolve the issue",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    }
  };

  const handleRetryExternalSetup = async (bookingId: string, missing: Parameters<typeof retryExternalSetup.mutateAsync>[0]["missing"]) => {
    try {
      const { failed } = await retryExternalSetup.mutateAsync({ bookingId, missing });
      if (failed.length) {
        toast({
          title: "Some steps still failed",
          description: failed.map((s) => EXTERNAL_SETUP_LABELS[s]).join(", "),
          variant: "destructive",
        });
      } else {
        toast({ title: "External booking setup completed" });
      }
    } catch (error) {
      toast({
        title: "Retry failed",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    }
  };
  
  const handleResolveAlert = async (alertId: string, e: React.MouseEvent) => {
    e.preventDefault(); // Prevent link navigation
    e.stopPropagation();
    
    try {
      await resolveAlert.mutateAsync(alertId);
      toast({
        title: "Alert Resolved",
        description: "The staff unassignment alert has been marked as resolved.",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to resolve alert. Please try again.",
        variant: "destructive",
      });
    }
  };

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
            <CardTitle className="text-sm font-medium">Booked value, events this week</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {loadingRevenue ? "..." : formatMoney(Number(weeklyRevenue?.total) || 0)}
            </div>
            <p className="text-xs text-muted-foreground">
              contract price of {weeklyRevenue?.count || 0} events this week, paid or not (money received: Reports)
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
              {loadingPipeline ? "..." : pipeline?.active ?? 0}
            </div>
            <p className="text-xs text-muted-foreground">active upcoming bookings (not cancelled)</p>
          </CardContent>
        </Card>

        <Card className={totalAlerts > 0 ? "border-destructive/50 bg-destructive/5" : ""}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">⚠️ Alerts</CardTitle>
            <AlertTriangle className={`h-4 w-4 ${totalAlerts > 0 ? "text-destructive" : "text-muted-foreground"}`} />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${totalAlerts > 0 ? "text-destructive" : ""}`}>
              {loadingAlerts || loadingIssueAlerts || loadingStaffUnassignments ? "..." : totalAlerts}
            </div>
            <p className="text-xs text-muted-foreground">need attention</p>
          </CardContent>
        </Card>
      </div>

      {/* Venue Access Code admin card */}
      <AccessCodeAdminCard />

      {/* Recurring access codes (FCG, Global, Guest) */}
      <RecurringAccessCodesCard />



      {/* Staff Unassignment Alerts Section */}
      {staffUnassignmentAlerts && staffUnassignmentAlerts.length > 0 && (
        <Card className="border-2 border-orange-500 bg-orange-500/5">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-orange-600 text-lg">
              <UserMinus className="h-5 w-5" />
              👤 Staff Unassignments - Require Attention
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Staff members have unassigned themselves from these bookings
            </p>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {staffUnassignmentAlerts.map((alert) => (
                <Link
                  key={alert.id}
                  to={`/admin/bookings/${alert.booking_id}`}
                  className="block p-4 rounded-lg border border-orange-500/30 bg-background hover:bg-orange-500/10 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-full bg-orange-500/20">
                      <UserMinus className="h-4 w-4 text-orange-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <Badge variant="outline" className="border-orange-500 text-orange-600">
                          👤 Staff Unassigned
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(alert.created_at), "MM/dd/yyyy 'at' h:mm a")}
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          className="ml-auto text-green-600 hover:text-green-700 hover:bg-green-50 border-green-500"
                          onClick={(e) => handleResolveAlert(alert.id, e)}
                        >
                          <CheckCircle className="h-4 w-4 mr-1" />
                          Resolve
                        </Button>
                      </div>
                      <p className="font-medium text-foreground">
                        {alert.booking?.reservation_number || 'N/A'} - {alert.booking?.full_name}
                      </p>
                      <p className="text-sm text-muted-foreground mb-2">
                        Event: {alert.booking?.event_date ? format(new Date(alert.booking.event_date + 'T00:00:00'), "MM/dd/yyyy") : 'N/A'}
                      </p>
                      <div className="p-3 bg-muted rounded-md">
                        <p className="text-sm font-medium text-foreground mb-1">Staff Member:</p>
                        <p className="text-sm text-foreground">
                          {alert.staff_name} ({alert.staff_role})
                        </p>
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* External bookings whose post-create steps did not all run */}
      {externalSetupAlerts && externalSetupAlerts.length > 0 && (
        <Card className="border-purple-500/50">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <AlertTriangle className="h-5 w-5 text-purple-600" />
              External bookings with incomplete setup
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              A step after creating these bookings did not finish (the tab may have closed). "Retry setup" reruns only the missing steps; the confirmation email goes to the guest, so it has its own button.
            </p>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {externalSetupAlerts.map((alert) => (
                <div key={alert.booking_id} className="flex items-center justify-between gap-3 p-3 rounded-lg border border-purple-500/30 flex-wrap">
                  <Link to={`/admin/bookings/${alert.booking_id}`} className="min-w-0 hover:underline">
                    <p className="font-medium">{alert.reservation_number || "N/A"} - {alert.full_name}</p>
                    <p className="text-sm text-muted-foreground">
                      {format(new Date(alert.event_date + 'T00:00:00'), "MM/dd/yyyy")} · Missing: {alert.missing.map((s) => EXTERNAL_SETUP_LABELS[s]).join(", ")}
                    </p>
                  </Link>
                  <div className="flex gap-2 flex-wrap">
                    {alert.missing.some((s) => AUTO_RETRY_STEPS.includes(s)) && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={retryExternalSetup.isPending}
                        onClick={() => handleRetryExternalSetup(alert.booking_id, alert.missing.filter((s) => AUTO_RETRY_STEPS.includes(s)))}
                      >
                        Retry setup
                      </Button>
                    )}
                    {alert.missing.includes("confirmation") && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={retryExternalSetup.isPending}
                        onClick={() => handleRetryExternalSetup(alert.booking_id, ["confirmation"])}
                      >
                        Send confirmation email
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Issue Alerts Section - Prominent */}
      {issueAlerts && issueAlerts.length > 0 && (
        <Card className="border-2 border-destructive bg-destructive/5">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-destructive text-lg">
              <AlertTriangle className="h-5 w-5" />
              🚨 Issue Reports - Require Attention
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              These issues were reported by staff or guests and need to be reviewed
            </p>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {issueAlerts.map((alert) => (
                <Link
                  key={alert.id}
                  to={`/admin/bookings/${alert.booking_id}`}
                  className="block p-4 rounded-lg border border-destructive/30 bg-background hover:bg-destructive/10 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <div className={`p-2 rounded-full ${alert.type === 'cleaning' ? 'bg-chart-1/20' : 'bg-chart-2/20'}`}>
                      {alert.type === 'cleaning' ? (
                        <Wrench className="h-4 w-4 text-chart-1" />
                      ) : (
                        <MessageSquareWarning className="h-4 w-4 text-chart-2" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <Badge variant={alert.type === 'cleaning' ? 'secondary' : 'outline'}>
                          {alert.type === 'cleaning' ? '🧹 Staff Report' : '👤 Guest Report'}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(alert.created_at), "MM/dd/yyyy 'at' h:mm a")}
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          className="ml-auto text-green-600 hover:text-green-700 hover:bg-green-50 border-green-500"
                          disabled={resolveIssue.isPending}
                          onClick={(e) => handleResolveIssue(alert.type === 'cleaning' ? 'cleaning' : 'guest', alert.id, e)}
                        >
                          <CheckCircle className="h-4 w-4 mr-1" />
                          Resolve
                        </Button>
                      </div>
                      <p className="font-medium text-foreground">
                        {alert.booking?.reservation_number || 'N/A'} - {alert.booking?.full_name}
                      </p>
                      <p className="text-sm text-muted-foreground mb-2">
                        Event: {alert.booking?.event_date ? format(new Date(alert.booking.event_date + 'T00:00:00'), "MM/dd/yyyy") : 'N/A'}
                        {alert.reported_by && ` • Reported by: ${alert.reported_by}`}
                      </p>
                      <div className="p-3 bg-muted rounded-md">
                        <p className="text-sm font-medium text-foreground mb-1">📝 Issue Description:</p>
                        <p className="text-sm text-foreground">{alert.issue_text}</p>
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

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
                          {format(new Date(booking.event_date + 'T00:00:00'), "MM/dd/yyyy")}
                          {booking.start_time && ` at ${booking.start_time.slice(0, 5)}`}
                        </p>
                        <p className="text-sm text-muted-foreground">{eventTypeLabel(booking.event_type, booking.event_type_other)}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-medium">{formatMoney(Number(booking.total_amount) || 0)}</p>
                        <Badge className={lifecycleColors[booking.lifecycle_status] || "bg-muted"}>
                          {lifecycleLabel(booking.lifecycle_status)}
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
                      <Badge className={lifecycleColors[status]}>{lifecycleLabel(status)}</Badge>
                    </div>
                    <span className="font-medium">{pipeline?.counts?.[status] || 0}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Operational Alerts - Events Not Ready */}
      {alerts && alerts.length > 0 && (
        <Card className="border-chart-1/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-chart-1">
              <Clock className="h-5 w-5" />
              📅 Upcoming Events Not Ready
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Events in the next 3 days that are not Pre-Event Ready (checklist or staff acceptance pending)
            </p>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {alerts.slice(0, 5).map((booking) => (
                <Link
                  key={booking.id}
                  to={`/admin/bookings/${booking.id}`}
                  className="block p-3 rounded-lg border border-chart-1/30 hover:bg-chart-1/5 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">{booking.full_name}</p>
                      <p className="text-sm text-muted-foreground">
                        {format(new Date(booking.event_date + 'T00:00:00'), "MM/dd/yyyy")} - {eventTypeLabel(booking.event_type, booking.event_type_other)}
                      </p>
                    </div>
                    <Badge variant="outline" className="border-chart-1 text-chart-1">Not Ready</Badge>
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
