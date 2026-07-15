import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Calendar, Users, Clock, FileText, ChevronRight, UserMinus } from "lucide-react";
import { useStaffAssignedBookings, useRemoveStaffAssignment } from "@/hooks/useStaffData";
import { useStaffSession } from "@/hooks/useStaffSession";
import { format, parseISO, isAfter, isBefore, addDays } from "date-fns";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { getAssignmentHours } from "@/lib/assignmentHours";

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
  const { staffMember } = useStaffSession();
  const { data: bookings, isLoading } = useStaffAssignedBookings();

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">My Bookings</h1>
        <p className="text-muted-foreground">
          Welcome, {staffMember?.full_name}. Here are your assigned bookings.
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
              <BookingCard key={booking.assignment_id ?? booking.id} booking={booking} />
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
              <BookingCard key={booking.assignment_id ?? booking.id} booking={booking} isPast />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function BookingCard({ booking, isPast }: { booking: any; isPast?: boolean }) {
  const isProduction = booking.assignment_role === "Production";
  const isBarVendor = booking.assignment_role === "Bar Vendor";
  const hasPackage = booking.package && booking.package !== "none";
  const hours = getAssignmentHours({
    scheduledStartTime: booking.scheduled_start_time ?? null,
    scheduledEndTime: booking.scheduled_end_time ?? null,
    assignmentRole: booking.assignment_role,
    packageName: booking.package ?? null,
    packageStartTime: booking.package_start_time ?? null,
    packageEndTime: booking.package_end_time ?? null,
    bookingStartTime: booking.start_time ?? null,
    bookingEndTime: booking.end_time ?? null,
  });
  const [showUnassignDialog, setShowUnassignDialog] = useState(false);
  const [assignmentIdToRemove, setAssignmentIdToRemove] = useState<string | null>(null);
  const removeAssignment = useRemoveStaffAssignment();
  const { toast } = useToast();
  
  const handleUnassignClick = (assignmentId: string) => {
    setAssignmentIdToRemove(assignmentId);
    setShowUnassignDialog(true);
  };
  
  const handleConfirmUnassign = async () => {
    if (!assignmentIdToRemove) return;
    
    try {
      await removeAssignment.mutateAsync({
        bookingId: booking.id,
        assignmentId: assignmentIdToRemove,
      });
      
      toast({
        title: "Successfully Unassigned",
        description: "You have been removed from this booking. The administrator has been notified.",
      });
      
      setShowUnassignDialog(false);
      setAssignmentIdToRemove(null);
    } catch (error) {
      toast({
        title: "Error",
        description: "No se pudo remover la asignación. Por favor intenta de nuevo.",
        variant: "destructive",
      });
    }
  };
  
  return (
    <>
      <Card className={`${isPast ? "opacity-70" : ""} ${isProduction && hasPackage ? "border-l-4 border-l-purple-500 bg-purple-500/5" : ""} ${isBarVendor ? "border-l-4 border-l-amber-500 bg-amber-500/5" : ""}`}>
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
                  <span>{format(parseISO(booking.event_date), "MM/dd/yyyy")}</span>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  {hours.source === "package" ? (
                    <Badge className="bg-purple-600 text-white flex items-center gap-1">
                      <span>🎬</span>
                      <span>{hours.start?.slice(0, 5)} - {hours.end?.slice(0, 5)}</span>
                    </Badge>
                  ) : (
                    <span>
                      {hours.start?.slice(0, 5)} - {hours.end?.slice(0, 5)}
                    </span>
                  )}
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

              {/* Bar Vendor: show bar service summary + contact status */}
              {isBarVendor && (
                <div className="rounded-md border border-amber-300/60 bg-amber-50 dark:bg-amber-950/20 p-3 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap text-sm">
                    <span className="font-semibold text-amber-800 dark:text-amber-200">🍷 Bar Service</span>
                    <Badge variant="outline" className="bg-white/60 dark:bg-background/60">
                      {booking.bar_package_label || booking.bar_package || "—"}
                    </Badge>
                    {booking.bar_guest_count != null && (
                      <span className="text-muted-foreground">{booking.bar_guest_count} guests</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap text-xs">
                    {booking.bar_customer_contacted || booking.customer_contacted ? (
                      <Badge className="bg-green-100 text-green-800 border-green-300">✓ Customer Contacted</Badge>
                    ) : (
                      <Badge className="bg-yellow-100 text-yellow-800 border-yellow-300">Awaiting Customer Contact</Badge>
                    )}
                    {booking.customer_contact_due_at && !(booking.bar_customer_contacted || booking.customer_contacted) && (
                      <span className="text-muted-foreground">
                        Due: {format(parseISO(booking.customer_contact_due_at), "MM/dd HH:mm")}
                      </span>
                    )}
                  </div>
                </div>
              )}
              {!isPast && booking.assignment_id && (
                <div className="pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleUnassignClick(booking.assignment_id)}
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  >
                    <UserMinus className="h-4 w-4 mr-2" />
                    Unassign Me
                  </Button>
                </div>
              )}
            </div>
            
            <Button asChild variant="ghost" size="icon">
              <Link to={`/staff/bookings/${booking.id}`}>
                <ChevronRight className="h-5 w-5" />
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={showUnassignDialog} onOpenChange={setShowUnassignDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unassign from this booking?</AlertDialogTitle>
            <AlertDialogDescription>
              This action will remove your assignment from this event. The administrator will be notified immediately.
              Are you sure you want to continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmUnassign} className="bg-destructive hover:bg-destructive/90">
              Yes, unassign me
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
