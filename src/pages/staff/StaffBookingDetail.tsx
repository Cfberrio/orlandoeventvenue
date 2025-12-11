import { Link, useParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Calendar, Clock, Users, FileText, ClipboardCheck } from "lucide-react";
import { useStaffBookingDetail, useBookingCleaningReport } from "@/hooks/useStaffData";
import { format, parseISO } from "date-fns";

const lifecycleColors: Record<string, string> = {
  pending: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20",
  confirmed: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  pre_event_ready: "bg-indigo-500/10 text-indigo-600 border-indigo-500/20",
  in_progress: "bg-green-500/10 text-green-600 border-green-500/20",
  post_event: "bg-purple-500/10 text-purple-600 border-purple-500/20",
  closed_review_complete: "bg-muted text-muted-foreground border-border",
  cancelled: "bg-destructive/10 text-destructive border-destructive/20",
};

const packageLabels: Record<string, string> = {
  none: "No Package",
  basic: "Basic A/V Package",
  led: "LED Wall Package",
  workshop: "Workshop/Streaming Package",
};

export default function StaffBookingDetail() {
  const { id } = useParams<{ id: string }>();
  const { data: booking, isLoading: bookingLoading } = useStaffBookingDetail(id || "");
  const { data: cleaningReport, isLoading: reportLoading } = useBookingCleaningReport(id || "");

  const isLoading = bookingLoading || reportLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!booking) {
    return (
      <div className="space-y-6">
        <Link to="/staff" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to My Bookings
        </Link>
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">Booking not found or you don't have access.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const cleaningStatus = cleaningReport?.status === 'completed' ? 'Completed' : 'Pending';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link to="/staff" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to My Bookings
        </Link>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            {booking.reservation_number || "Booking Details"}
          </h1>
          <p className="text-muted-foreground">{booking.full_name}</p>
        </div>
        <Badge variant="outline" className={lifecycleColors[booking.lifecycle_status] || ""}>
          {booking.lifecycle_status?.replace(/_/g, ' ')}
        </Badge>
      </div>

      {/* Event Info Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Event Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Calendar className="h-4 w-4" />
                <span>Event Date</span>
              </div>
              <p className="font-medium">{format(parseISO(booking.event_date), "EEEE, MMMM d, yyyy")}</p>
            </div>
            
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Clock className="h-4 w-4" />
                <span>Time</span>
              </div>
              <p className="font-medium">
                {booking.start_time?.slice(0, 5)} - {booking.end_time?.slice(0, 5)}
              </p>
            </div>
            
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Users className="h-4 w-4" />
                <span>Guests</span>
              </div>
              <p className="font-medium">{booking.number_of_guests} guests</p>
            </div>
            
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <FileText className="h-4 w-4" />
                <span>Event Type</span>
              </div>
              <p className="font-medium">{booking.event_type}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-border">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Booking Type</p>
              <p className="font-medium capitalize">{booking.booking_type}</p>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Package</p>
              <p className="font-medium">{packageLabels[booking.package] || booking.package}</p>
            </div>
          </div>

          {booking.client_notes && (
            <div className="pt-4 border-t border-border">
              <p className="text-sm text-muted-foreground mb-2">Client Notes</p>
              <p className="text-sm bg-muted p-3 rounded-md">{booking.client_notes}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Cleaning Report Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5" />
            Cleaning Report
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Status</p>
              <Badge variant={cleaningStatus === 'Completed' ? 'default' : 'secondary'}>
                {cleaningStatus}
              </Badge>
            </div>
            <Button asChild>
              <Link to={`/staff/bookings/${booking.id}/cleaning-report`}>
                {cleaningStatus === 'Completed' ? 'View / Edit Report' : 'Fill Cleaning Report'}
              </Link>
            </Button>
          </div>
          
          {cleaningReport?.completed_at && (
            <p className="text-sm text-muted-foreground mt-4">
              Submitted on {format(parseISO(cleaningReport.completed_at), "MMM d, yyyy 'at' h:mm a")}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
