import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar, Users, Clock, FileText, ChevronRight } from "lucide-react";
import { useStaffAssignedBookings, useCurrentStaffMember } from "@/hooks/useStaffData";
import { format, parseISO, isAfter, isBefore, addDays } from "date-fns";

const lifecycleColors: Record<string, string> = {
  pending: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20",
  confirmed: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  pre_event_ready: "bg-indigo-500/10 text-indigo-600 border-indigo-500/20",
  in_progress: "bg-green-500/10 text-green-600 border-green-500/20",
  post_event: "bg-purple-500/10 text-purple-600 border-purple-500/20",
  closed_review_complete: "bg-muted text-muted-foreground border-border",
  cancelled: "bg-destructive/10 text-destructive border-destructive/20",
};

export default function StaffBookingsList() {
  const { data: staffMember, isLoading: staffLoading } = useCurrentStaffMember();
  const { data: bookings, isLoading: bookingsLoading } = useStaffAssignedBookings();

  const isLoading = staffLoading || bookingsLoading;

  const today = new Date();
  const upcomingBookings = bookings?.filter(b => 
    isAfter(parseISO(b.event_date), addDays(today, -1)) && 
    b.lifecycle_status !== 'cancelled'
  ) || [];
  const pastBookings = bookings?.filter(b => 
    isBefore(parseISO(b.event_date), today) ||
    b.lifecycle_status === 'cancelled'
  ) || [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!staffMember) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-foreground">My Bookings</h1>
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">
              Your email is not linked to a staff member profile. Please contact an administrator.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">My Bookings</h1>
        <p className="text-muted-foreground">
          Welcome, {staffMember.full_name}. Here are your assigned bookings.
        </p>
      </div>

      {/* Upcoming Bookings */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-foreground">Upcoming & Current</h2>
        {upcomingBookings.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center">
              <p className="text-muted-foreground">No upcoming bookings assigned to you.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {upcomingBookings.map((booking) => (
              <BookingCard key={booking.id} booking={booking} />
            ))}
          </div>
        )}
      </div>

      {/* Past Bookings */}
      {pastBookings.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-foreground">Past Bookings</h2>
          <div className="grid gap-4">
            {pastBookings.slice(0, 10).map((booking) => (
              <BookingCard key={booking.id} booking={booking} isPast />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function BookingCard({ booking, isPast }: { booking: any; isPast?: boolean }) {
  return (
    <Card className={isPast ? "opacity-70" : ""}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className={lifecycleColors[booking.lifecycle_status] || ""}>
                {booking.lifecycle_status?.replace(/_/g, ' ')}
              </Badge>
              <Badge variant="secondary">
                {booking.assignment_role}
              </Badge>
              {booking.reservation_number && (
                <span className="text-sm font-mono text-muted-foreground">
                  {booking.reservation_number}
                </span>
              )}
            </div>
            
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Calendar className="h-4 w-4" />
                <span>{format(parseISO(booking.event_date), "MMM d, yyyy")}</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Clock className="h-4 w-4" />
                <span>
                  {booking.start_time?.slice(0, 5)} - {booking.end_time?.slice(0, 5)}
                </span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Users className="h-4 w-4" />
                <span>{booking.number_of_guests} guests</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <FileText className="h-4 w-4" />
                <span>{booking.event_type}</span>
              </div>
            </div>
          </div>
          
          <Button asChild variant="ghost" size="icon">
            <Link to={`/staff/bookings/${booking.id}`}>
              <ChevronRight className="h-5 w-5" />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
