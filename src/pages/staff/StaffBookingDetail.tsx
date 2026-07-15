import { Link, useParams, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { ArrowLeft, Calendar, Clock, Users, FileText, ClipboardCheck, UserMinus, Wine, Phone, Mail, MapPin, CheckCircle2 } from "lucide-react";
import { useStaffBookingDetail, useBookingCleaningReport, useRemoveStaffAssignment, useMarkBarCustomerContacted } from "@/hooks/useStaffData";
import { useStaffSession } from "@/hooks/useStaffSession";
import { format, parseISO, isToday, isPast } from "date-fns";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import StaffAddonsPanel from "@/components/staff/StaffAddonsPanel";
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

const packageLabels: Record<string, string> = {
  none: "No Package",
  basic: "Basic A/V Package",
  led: "LED Wall Package",
  workshop: "Workshop/Streaming Package",
};

export default function StaffBookingDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { staffMember } = useStaffSession();
  const { data: booking, isLoading: bookingLoading } = useStaffBookingDetail(id || "");
  const { data: cleaningReport, isLoading: reportLoading } = useBookingCleaningReport(id || "");
  const [showUnassignDialog, setShowUnassignDialog] = useState(false);
  const removeAssignment = useRemoveStaffAssignment();
  const markBarContacted = useMarkBarCustomerContacted();
  const { toast } = useToast();

  const isBarVendor = booking?.assignment_role === "Bar Vendor";
  const isLoading = bookingLoading || reportLoading;

  const handleUnassignClick = () => {
    setShowUnassignDialog(true);
  };
  
  const handleConfirmUnassign = async () => {
    if (!booking?.assignment_id) return;
    
    try {
      await removeAssignment.mutateAsync({
        bookingId: booking.id,
        assignmentId: booking.assignment_id,
      });
      
      toast({
        title: "Successfully Unassigned",
        description: "You have been removed from this booking. The administrator has been notified.",
      });
      
      setShowUnassignDialog(false);
      
      // Navigate back to bookings list after unassigning
      setTimeout(() => {
        navigate("/staff");
      }, 1500);
    } catch (error) {
      toast({
        title: "Error",
        description: "No se pudo remover la asignación. Por favor intenta de nuevo.",
        variant: "destructive",
      });
    }
  };

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

  const effectiveHours = getAssignmentHours({
    scheduledStartTime: booking.scheduled_start_time ?? null,
    scheduledEndTime: booking.scheduled_end_time ?? null,
    assignmentRole: booking.assignment_role,
    packageName: booking.package ?? null,
    packageStartTime: booking.package_start_time ?? null,
    packageEndTime: booking.package_end_time ?? null,
    bookingStartTime: booking.start_time ?? null,
    bookingEndTime: booking.end_time ?? null,
  });

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
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={lifecycleColors[booking.lifecycle_status] || ""}>
            {booking.lifecycle_status?.replace(/_/g, ' ')}
          </Badge>
          {booking.assignment_id && booking.lifecycle_status !== 'cancelled' && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleUnassignClick}
              className="text-destructive hover:text-destructive hover:bg-destructive/10"
            >
              <UserMinus className="h-4 w-4 mr-2" />
              Unassign Me
            </Button>
          )}
        </div>
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
              <p className="font-medium">{format(parseISO(booking.event_date), "EEEE, MM/dd/yyyy")}</p>
            </div>
            
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Clock className="h-4 w-4" />
                <span>Event Time</span>
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

      <StaffAddonsPanel booking={booking} />

      {/* Production Hours Card - Only show for Production staff with package */}
      {booking.assignment_role === "Production" && booking.package && booking.package !== "none" && booking.package_start_time && booking.package_end_time && (
        <Card className="border-l-4 border-l-purple-500 bg-purple-500/5">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <span>🎬</span>
              <span>Your Production Hours</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                As Production staff, you are assigned to work during the package hours only:
              </p>
              <Badge className="bg-purple-600 text-white text-base px-4 py-2">
                {effectiveHours.start?.slice(0, 5)} - {effectiveHours.end?.slice(0, 5)}
              </Badge>
              <p className="text-xs text-muted-foreground">
                Package: {packageLabels[booking.package]}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Assistant Tasks Card - Only for Assistant role */}
      {booking.assignment_role === "Assistant" && (
        <Card className="border-l-4 border-l-orange-500 bg-orange-500/5">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <span>📋</span>
              <span>Your Assigned Tasks</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-orange-100/60 dark:bg-orange-950/40 border border-orange-200 dark:border-orange-800">
                <Clock className="h-4 w-4 text-orange-600 dark:text-orange-400 shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Working Hours</p>
                  <p className="font-semibold text-orange-700 dark:text-orange-300">
                    {effectiveHours.start?.slice(0, 5)} – {effectiveHours.end?.slice(0, 5)}
                  </p>
                </div>
              </div>

              {booking.assignment_tasks && booking.assignment_tasks.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-foreground">Tasks to complete:</p>
                  <ul className="space-y-2">
                    {(booking.assignment_tasks as Array<{ id: string; name: string; completed: boolean }>).map((task, index) => (
                      <li key={task.id} className="flex items-start gap-3 p-3 rounded-lg bg-white dark:bg-background border border-orange-200 dark:border-orange-800">
                        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-orange-500 text-white text-xs flex items-center justify-center font-bold mt-0.5">
                          {index + 1}
                        </span>
                        <span className="text-sm font-medium">{task.name}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground italic">No specific tasks assigned. Check with your supervisor.</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Bar Vendor Card */}
      {isBarVendor && (() => {
        // Bar Vendor must always see full client contact info to perform their job.
        const phoneVisible = true;
        const isContacted = booking.assignment_customer_contacted || booking.bar_customer_contacted;
        const dueAt = booking.assignment_customer_contact_due_at;

        return (
          <Card className="border-l-4 border-l-amber-500 bg-amber-500/5">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Wine className="h-5 w-5 text-amber-600" />
                Bar Service Assignment
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Bar package info */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground uppercase">Package</p>
                  <p className="font-semibold">{booking.bar_package_label || booking.bar_package || "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase">Guests</p>
                  <p className="font-semibold">{booking.bar_guest_count ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase">Status</p>
                  {isContacted ? (
                    <Badge className="bg-green-100 text-green-800 border-green-300">
                      <CheckCircle2 className="h-3 w-3 mr-1" /> Customer Contacted
                    </Badge>
                  ) : (
                    <Badge className="bg-yellow-100 text-yellow-800 border-yellow-300">Awaiting Customer Contact</Badge>
                  )}
                </div>
              </div>

              {/* Venue address */}
              <div className="rounded-md border border-amber-300/60 bg-white/60 dark:bg-background/60 p-3">
                <div className="flex items-start gap-2">
                  <MapPin className="h-4 w-4 text-amber-700 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground uppercase">Venue Address</p>
                    <p className="text-sm font-medium">3847 E Colonial Dr, Orlando, FL 32803</p>
                  </div>
                </div>
              </div>

              {/* Bar internal notes (if available) */}
              {booking.bar_internal_notes && (
                <div className="rounded-md border border-amber-300/60 bg-white/60 dark:bg-background/60 p-3">
                  <p className="text-xs text-muted-foreground uppercase mb-1">Bar Notes</p>
                  <p className="text-sm whitespace-pre-wrap">{booking.bar_internal_notes}</p>
                </div>
              )}

              {/* Customer contact task */}
              <div className="rounded-md border border-amber-300/60 bg-white/60 dark:bg-background/60 p-4 space-y-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <p className="text-sm font-semibold">Task: Contact client</p>
                    {dueAt && !isContacted && (
                      <p className="text-xs text-muted-foreground">
                        Due: {format(parseISO(dueAt), "EEEE MM/dd/yyyy 'at' HH:mm")}
                      </p>
                    )}
                    {isContacted && booking.assignment_customer_contacted_at && (
                      <p className="text-xs text-green-700 dark:text-green-400">
                        Completed {format(parseISO(booking.assignment_customer_contacted_at), "MM/dd/yyyy HH:mm")}
                      </p>
                    )}
                  </div>
                  {!isContacted && booking.assignment_id && (
                    <Button
                      onClick={async () => {
                        try {
                          await markBarContacted.mutateAsync({
                            bookingId: booking.id,
                            assignmentId: booking.assignment_id,
                          });
                          toast({ title: "Customer marked as contacted" });
                        } catch (e) {
                          toast({
                            title: "Failed to update",
                            description: e instanceof Error ? e.message : "Unknown error",
                            variant: "destructive",
                          });
                        }
                      }}
                      disabled={markBarContacted.isPending}
                    >
                      <CheckCircle2 className="h-4 w-4 mr-2" />
                      Mark Customer Contacted
                    </Button>
                  )}
                </div>
              </div>

              {/* Client contact info — gated by phone visibility rule */}
              <div className="rounded-md border border-amber-300/60 bg-white/60 dark:bg-background/60 p-4 space-y-2">
                <p className="text-xs text-muted-foreground uppercase">Client Contact</p>
                <div className="space-y-1.5 text-sm">
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">{booking.full_name}</span>
                  </div>
                  {phoneVisible ? (
                    <>
                      <div className="flex items-center gap-2">
                        <Phone className="h-4 w-4 text-muted-foreground" />
                        <a href={`tel:${booking.phone}`} className="text-primary hover:underline">{booking.phone}</a>
                      </div>
                      {booking.email && (
                        <div className="flex items-center gap-2">
                          <Mail className="h-4 w-4 text-muted-foreground" />
                          <a href={`mailto:${booking.email}`} className="text-primary hover:underline">{booking.email}</a>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="flex items-start gap-2 text-muted-foreground italic">
                      <Phone className="h-4 w-4 mt-0.5 shrink-0" />
                      <span>Client phone will be available on the day of the event or when released by admin.</span>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* Cleaning Report Card - Hidden for Production, Assistant, and Bar Vendor roles */}
      {staffMember?.role !== 'Production' && staffMember?.role !== 'Assistant' && staffMember?.role !== 'Bar Vendor' && (
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
                Submitted on {format(parseISO(cleaningReport.completed_at), "MM/dd/yyyy 'at' h:mm a")}
              </p>
            )}
          </CardContent>
        </Card>
      )}

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
    </div>
  );
}
