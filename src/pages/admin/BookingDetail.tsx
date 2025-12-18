import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useParams, Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  ArrowLeft, 
  User, 
  Calendar, 
  Users, 
  DollarSign,
  CheckCircle,
  FileText,
  Star,
  Paperclip,
  Plus,
  Trash2,
  Mail,
  Phone,
  Building,
  Clock,
  CreditCard
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import {
  useBooking,
  useBookingStaffAssignments,
  useBookingHostReports,
  useBookingReviews,
  useBookingAttachments,
  useStaffMembers,
  useUpdateBooking,
  useCreateStaffAssignment,
  useDeleteStaffAssignment,
  useUpdateHostReport,
} from "@/hooks/useAdminData";

const lifecycleStatuses = [
  "pending",
  "confirmed",
  "pre_event_ready",
  "in_progress",
  "post_event",
  "closed_review_complete",
  "cancelled",
];

const lifecycleLabels: Record<string, string> = {
  pending: "⏳ Pending Review",
  confirmed: "✅ Confirmed",
  pre_event_ready: "🎯 Ready for Event",
  in_progress: "🔴 Event In Progress",
  post_event: "📋 Post Event",
  closed_review_complete: "✔️ Closed",
  cancelled: "❌ Cancelled",
};

const lifecycleColors: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800 border-yellow-300",
  confirmed: "bg-blue-100 text-blue-800 border-blue-300",
  pre_event_ready: "bg-green-100 text-green-800 border-green-300",
  in_progress: "bg-red-100 text-red-800 border-red-300",
  post_event: "bg-purple-100 text-purple-800 border-purple-300",
  closed_review_complete: "bg-gray-100 text-gray-800 border-gray-300",
  cancelled: "bg-destructive/20 text-destructive border-destructive/30",
};

const paymentStatusColors: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  deposit_paid: "bg-blue-100 text-blue-800",
  fully_paid: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
  refunded: "bg-gray-100 text-gray-800",
  invoiced: "bg-purple-100 text-purple-800",
};

const assignmentRoles = ["manager_on_duty", "support", "door", "cleaner", "other"];

export default function BookingDetail() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();

  const { data: booking, isLoading } = useBooking(id!);
  const { data: assignments } = useBookingStaffAssignments(id!);
  const { data: hostReports } = useBookingHostReports(id!);
  const { data: reviews } = useBookingReviews(id!);
  const { data: attachments } = useBookingAttachments(id!);
  const { data: staffMembers } = useStaffMembers({ isActive: true });

  const updateBooking = useUpdateBooking();
  const createAssignment = useCreateStaffAssignment();
  const deleteAssignment = useDeleteStaffAssignment();
  const updateHostReport = useUpdateHostReport();

  // Form states
  const [newAssignmentStaff, setNewAssignmentStaff] = useState("");
  const [newAssignmentRole, setNewAssignmentRole] = useState("");
  const [newAssignmentNotes, setNewAssignmentNotes] = useState("");

  // Confirmation checklist states
  const [scheduleAvailability, setScheduleAvailability] = useState(false);
  const [staffingAvailability, setStaffingAvailability] = useState(false);
  const [eventTypeConflicts, setEventTypeConflicts] = useState(false);

  // Post-event close state
  const [reviewReceived, setReviewReceived] = useState(false);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading booking details...</p>
        </div>
      </div>
    );
  }

  if (!booking) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <p className="text-xl font-semibold text-foreground mb-2">Booking not found</p>
          <Link to="/admin/bookings">
            <Button variant="outline">Back to Bookings</Button>
          </Link>
        </div>
      </div>
    );
  }

  const handleStatusChange = async (newStatus: string) => {
    try {
      await updateBooking.mutateAsync({ id: booking.id, updates: { lifecycle_status: newStatus } });
      
      // If changing to pre_event_ready, schedule host report reminders
      if (newStatus === "pre_event_ready") {
        await supabase.functions.invoke("sync-to-ghl", {
          body: { booking_id: booking.id },
        });
        await supabase.functions.invoke("schedule-balance-payment", {
          body: { booking_id: booking.id },
        });
      }
      
      toast({ title: "Status updated successfully" });
    } catch {
      toast({ title: "Failed to update status", variant: "destructive" });
    }
  };

  const handleMarkPreEventReady = async () => {
    try {
      await updateBooking.mutateAsync({
        id: booking.id,
        updates: {
          pre_event_ready: "true",
          lifecycle_status: "pre_event_ready",
        },
      });
      // Sync to GHL
      await supabase.functions.invoke("sync-to-ghl", {
        body: { booking_id: booking.id },
      });
      // Schedule host report reminders and balance payment jobs
      await supabase.functions.invoke("schedule-balance-payment", {
        body: { booking_id: booking.id },
      });
      toast({ title: "Booking marked as ready for event" });
    } catch {
      toast({ title: "Failed to update", variant: "destructive" });
    }
  };

  const handleConfirmationCheck = async (
    field: "schedule" | "staffing" | "conflicts",
    checked: boolean
  ) => {
    const newSchedule = field === "schedule" ? checked : scheduleAvailability;
    const newStaffing = field === "staffing" ? checked : staffingAvailability;
    const newConflicts = field === "conflicts" ? checked : eventTypeConflicts;

    if (field === "schedule") setScheduleAvailability(checked);
    if (field === "staffing") setStaffingAvailability(checked);
    if (field === "conflicts") setEventTypeConflicts(checked);

    if (newSchedule && newStaffing && newConflicts) {
      try {
        await updateBooking.mutateAsync({
          id: booking.id,
          updates: { pre_event_ready: "true" },
        });
        await supabase.functions.invoke("sync-to-ghl", {
          body: { booking_id: booking.id },
        });
        await supabase.functions.invoke("schedule-balance-payment", {
          body: { booking_id: booking.id },
        });
        toast({ title: "✅ Checklist complete! Booking confirmed." });
      } catch {
        toast({ title: "Failed to save checklist", variant: "destructive" });
      }
    }
  };

  const handleReviewReceivedCheck = async (checked: boolean) => {
    setReviewReceived(checked);
    if (checked) {
      try {
        await updateBooking.mutateAsync({
          id: booking.id,
          updates: { lifecycle_status: "closed_review_complete" },
        });
        toast({ title: "Booking closed successfully" });
      } catch {
        toast({ title: "Failed to close booking", variant: "destructive" });
      }
    }
  };

  const handleAddAssignment = async () => {
    if (!newAssignmentStaff || !newAssignmentRole) {
      toast({ title: "Please select staff and role", variant: "destructive" });
      return;
    }
    try {
      await createAssignment.mutateAsync({
        booking_id: booking.id,
        staff_id: newAssignmentStaff,
        assignment_role: newAssignmentRole,
        notes: newAssignmentNotes || undefined,
      });
      setNewAssignmentStaff("");
      setNewAssignmentRole("");
      setNewAssignmentNotes("");
      toast({ title: "Staff assigned successfully" });
    } catch {
      toast({ title: "Failed to assign staff", variant: "destructive" });
    }
  };

  const handleDeleteAssignment = async (assignmentId: string) => {
    try {
      await deleteAssignment.mutateAsync({ id: assignmentId, bookingId: booking.id });
      toast({ title: "Staff removed" });
    } catch {
      toast({ title: "Failed to remove staff", variant: "destructive" });
    }
  };

  const handleForceSyncHostReport = async () => {
    try {
      toast({ title: "Triggering host report sync..." });
      
      // First call schedule-balance-payment to set host_report_step
      const { data: scheduleResult, error: scheduleError } = await supabase.functions.invoke(
        "schedule-balance-payment",
        { body: { booking_id: booking.id } }
      );
      
      if (scheduleError) {
        console.error("schedule-balance-payment error:", scheduleError);
        throw scheduleError;
      }
      
      console.log("schedule-balance-payment result:", scheduleResult);
      
      // Then sync to GHL
      const { error: syncError } = await supabase.functions.invoke("sync-to-ghl", {
        body: { booking_id: booking.id },
      });
      
      if (syncError) {
        console.error("sync-to-ghl error:", syncError);
        throw syncError;
      }
      
      toast({ 
        title: "Host report sync completed",
        description: scheduleResult?.host_report_step 
          ? `Step set to: ${scheduleResult.host_report_step}` 
          : "Check booking for updated host_report_step"
      });
      
      // Refetch booking data
      window.location.reload();
    } catch (error) {
      console.error("Force sync error:", error);
      toast({ 
        title: "Failed to sync host report", 
        description: String(error),
        variant: "destructive" 
      });
    }
  };

  const hostReport = hostReports?.[0];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link to="/admin/bookings">
          <Button variant="ghost" size="icon" className="hover:bg-accent">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold text-foreground">{booking.full_name}</h1>
            {booking.reservation_number && (
              <Badge variant="outline" className="font-mono">
                {booking.reservation_number}
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            {format(new Date(booking.event_date), "EEEE, MMMM d, yyyy")}
            <span className="mx-1">•</span>
            {booking.event_type}
          </p>
        </div>
        
        {/* Status Selector with visual styling */}
        <div className="flex flex-col items-end gap-2">
          <Badge className={`text-sm px-3 py-1 ${lifecycleColors[booking.lifecycle_status] || ""}`}>
            {lifecycleLabels[booking.lifecycle_status] || booking.lifecycle_status}
          </Badge>
          <Select value={booking.lifecycle_status} onValueChange={handleStatusChange}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Change status" />
            </SelectTrigger>
            <SelectContent>
              {lifecycleStatuses.map((status) => (
                <SelectItem key={status} value={status}>
                  {lifecycleLabels[status] || status.replace(/_/g, " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="bg-muted/50 p-1">
          <TabsTrigger value="overview" className="data-[state=active]:bg-background">
            📋 Overview
          </TabsTrigger>
          <TabsTrigger value="checklist" className="data-[state=active]:bg-background">
            ✅ Pre-Event
          </TabsTrigger>
          <TabsTrigger value="staff" className="data-[state=active]:bg-background">
            👥 Staff
          </TabsTrigger>
          <TabsTrigger value="host" className="data-[state=active]:bg-background">
            📝 Host Report
          </TabsTrigger>
          <TabsTrigger value="reviews" className="data-[state=active]:bg-background">
            ⭐ Reviews
          </TabsTrigger>
          <TabsTrigger value="attachments" className="data-[state=active]:bg-background">
            📎 Files
          </TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Contact Information */}
            <Card className="border-l-4 border-l-blue-500">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <User className="h-5 w-5 text-blue-500" />
                  Contact Information
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-3">
                  <User className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">{booking.full_name}</span>
                </div>
                <div className="flex items-center gap-3">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <a href={`mailto:${booking.email}`} className="text-primary hover:underline">
                    {booking.email}
                  </a>
                </div>
                <div className="flex items-center gap-3">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <a href={`tel:${booking.phone}`} className="text-primary hover:underline">
                    {booking.phone}
                  </a>
                </div>
                {booking.company && (
                  <div className="flex items-center gap-3">
                    <Building className="h-4 w-4 text-muted-foreground" />
                    <span>{booking.company}</span>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Event Details */}
            <Card className="border-l-4 border-l-purple-500">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Calendar className="h-5 w-5 text-purple-500" />
                  Event Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Date</p>
                    <p className="font-medium">{format(new Date(booking.event_date), "MMM d, yyyy")}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Time</p>
                    <p className="font-medium flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {booking.start_time?.slice(0, 5) || "-"} - {booking.end_time?.slice(0, 5) || "-"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Event Type</p>
                    <p className="font-medium">{booking.event_type}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Guests</p>
                    <p className="font-medium flex items-center gap-1">
                      <Users className="h-3 w-3" />
                      {booking.number_of_guests} people
                    </p>
                  </div>
                </div>
                <div className="pt-2 border-t">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Booking Type</p>
                  <Badge variant="outline" className="mt-1">
                    {booking.booking_type === "hourly" ? "⏱️ Hourly" : "📅 Full Day"}
                  </Badge>
                </div>
              </CardContent>
            </Card>

            {/* Services */}
            <Card className="border-l-4 border-l-orange-500">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Users className="h-5 w-5 text-orange-500" />
                  Services & Add-ons
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Package</span>
                  <Badge>{booking.package || "None"}</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Setup & Breakdown</span>
                  <Badge variant={booking.setup_breakdown ? "default" : "secondary"}>
                    {booking.setup_breakdown ? "✓ Included" : "Not included"}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Tablecloths</span>
                  <Badge variant={booking.tablecloths ? "default" : "secondary"}>
                    {booking.tablecloths ? `✓ ${booking.tablecloth_quantity} cloths` : "Not included"}
                  </Badge>
                </div>
                {booking.client_notes && (
                  <div className="pt-2 border-t">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Client Notes</p>
                    <p className="text-sm bg-muted/50 p-2 rounded">{booking.client_notes}</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Financial Summary */}
            <Card className="border-l-4 border-l-green-500">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <DollarSign className="h-5 w-5 text-green-500" />
                  Payment Summary
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Base Rental</span>
                    <span>${Number(booking.base_rental).toLocaleString()}</span>
                  </div>
                  {Number(booking.package_cost) > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Package</span>
                      <span>${Number(booking.package_cost).toLocaleString()}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Cleaning Fee</span>
                    <span>${Number(booking.cleaning_fee).toLocaleString()}</span>
                  </div>
                  {Number(booking.optional_services) > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Services</span>
                      <span>${Number(booking.optional_services).toLocaleString()}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Taxes & Fees</span>
                    <span>${Number(booking.taxes_fees).toLocaleString()}</span>
                  </div>
                </div>
                
                <div className="pt-3 border-t space-y-2">
                  <div className="flex justify-between text-lg font-bold">
                    <span>Total</span>
                    <span className="text-green-600">${Number(booking.total_amount).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Deposit Paid</span>
                    <span className="text-green-600">${Number(booking.deposit_amount).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Balance Due</span>
                    <span className="font-medium">${Number(booking.balance_amount).toLocaleString()}</span>
                  </div>
                </div>

                <div className="pt-3 border-t flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Payment Status</span>
                  <Badge className={`${paymentStatusColors[booking.payment_status] || ""} flex items-center gap-1`}>
                    <CreditCard className="h-3 w-3" />
                    {booking.payment_status.replace(/_/g, " ")}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Pre-Event Checklist Tab */}
        <TabsContent value="checklist" className="space-y-4">
          {/* Confirmation Checklist - shown when pending */}
          {booking.lifecycle_status === "pending" && (
            <Card className="border-2 border-yellow-200 bg-yellow-50/50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-yellow-800">
                  <CheckCircle className="h-5 w-5" />
                  📋 Confirmation Checklist
                </CardTitle>
                <p className="text-sm text-yellow-700">
                  Complete all items below to confirm this booking
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-4">
                  <div className="flex items-center space-x-3 p-3 rounded-lg bg-background border hover:bg-accent/50 transition-colors">
                    <Checkbox
                      id="schedule"
                      checked={scheduleAvailability}
                      onCheckedChange={(checked) =>
                        handleConfirmationCheck("schedule", checked as boolean)
                      }
                      className="h-5 w-5"
                    />
                    <label htmlFor="schedule" className="flex-1 cursor-pointer">
                      <span className="font-medium">Schedule Availability</span>
                      <p className="text-sm text-muted-foreground">Venue is available on the requested date</p>
                    </label>
                  </div>
                  <div className="flex items-center space-x-3 p-3 rounded-lg bg-background border hover:bg-accent/50 transition-colors">
                    <Checkbox
                      id="staffing"
                      checked={staffingAvailability}
                      onCheckedChange={(checked) =>
                        handleConfirmationCheck("staffing", checked as boolean)
                      }
                      className="h-5 w-5"
                    />
                    <label htmlFor="staffing" className="flex-1 cursor-pointer">
                      <span className="font-medium">Staffing Availability</span>
                      <p className="text-sm text-muted-foreground">Staff can be assigned for this event</p>
                    </label>
                  </div>
                  <div className="flex items-center space-x-3 p-3 rounded-lg bg-background border hover:bg-accent/50 transition-colors">
                    <Checkbox
                      id="conflicts"
                      checked={eventTypeConflicts}
                      onCheckedChange={(checked) =>
                        handleConfirmationCheck("conflicts", checked as boolean)
                      }
                      className="h-5 w-5"
                    />
                    <label htmlFor="conflicts" className="flex-1 cursor-pointer">
                      <span className="font-medium">No Event Conflicts</span>
                      <p className="text-sm text-muted-foreground">No scheduling conflicts with other events</p>
                    </label>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Post-Event Close - shown when post_event */}
          {booking.lifecycle_status === "post_event" && (
            <Card className="border-2 border-purple-200 bg-purple-50/50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-purple-800">
                  <Star className="h-5 w-5" />
                  🎉 Close Booking
                </CardTitle>
                <p className="text-sm text-purple-700">
                  Event is complete. Confirm review received to close this booking.
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center space-x-3 p-3 rounded-lg bg-background border hover:bg-accent/50 transition-colors">
                  <Checkbox
                    id="reviewReceived"
                    checked={reviewReceived}
                    onCheckedChange={(checked) =>
                      handleReviewReceivedCheck(checked as boolean)
                    }
                    className="h-5 w-5"
                  />
                  <label htmlFor="reviewReceived" className="flex-1 cursor-pointer">
                    <span className="font-medium">Guest review has been received</span>
                    <p className="text-sm text-muted-foreground">Check this to close the booking</p>
                  </label>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Pre-Event Ready Status */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5" />
                Pre-Event Status
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4">
                <Badge 
                  variant="outline"
                  className={booking.pre_event_ready === "true" 
                    ? "bg-green-100 text-green-800 border-green-300 text-base px-4 py-1" 
                    : "bg-yellow-100 text-yellow-800 border-yellow-300 text-base px-4 py-1"
                  }
                >
                  {booking.pre_event_ready === "true" ? "✅ Ready for Event" : "⏳ Not Ready Yet"}
                </Badge>
              </div>
              {booking.pre_event_ready !== "true" && booking.lifecycle_status !== "pending" && (
                <Button onClick={handleMarkPreEventReady} size="lg" className="mt-2">
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Mark as Ready for Event
                </Button>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Staff Assignments Tab */}
        <TabsContent value="staff">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                👥 Staff Assignments
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Assign staff members to this event
              </p>
            </CardHeader>
            <CardContent className="space-y-6">
              {assignments?.length === 0 ? (
                <div className="text-center py-8 bg-muted/30 rounded-lg">
                  <Users className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                  <p className="text-muted-foreground font-medium">No staff assigned yet</p>
                  <p className="text-sm text-muted-foreground">Use the form below to assign staff</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Staff Member</TableHead>
                      <TableHead>Staff Role</TableHead>
                      <TableHead>Assignment</TableHead>
                      <TableHead>Notes</TableHead>
                      <TableHead className="w-[50px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {assignments?.map((assignment) => (
                      <TableRow key={assignment.id}>
                        <TableCell className="font-medium">{assignment.staff_member?.full_name}</TableCell>
                        <TableCell>
                          <Badge variant="secondary">{assignment.staff_member?.role}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{assignment.assignment_role.replace(/_/g, " ")}</Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{assignment.notes || "-"}</TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDeleteAssignment(assignment.id)}
                            className="hover:bg-destructive/10"
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}

              {/* Add Assignment Form */}
              <div className="pt-4 border-t">
                <p className="text-sm font-medium mb-3">Add New Assignment</p>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <Select value={newAssignmentStaff} onValueChange={setNewAssignmentStaff}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select staff member" />
                    </SelectTrigger>
                    <SelectContent>
                      {staffMembers?.map((staff) => (
                        <SelectItem key={staff.id} value={staff.id}>
                          {staff.full_name} ({staff.role})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={newAssignmentRole} onValueChange={setNewAssignmentRole}>
                    <SelectTrigger>
                      <SelectValue placeholder="Assignment role" />
                    </SelectTrigger>
                    <SelectContent>
                      {assignmentRoles.map((role) => (
                        <SelectItem key={role} value={role}>
                          {role.replace(/_/g, " ")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    placeholder="Notes (optional)"
                    value={newAssignmentNotes}
                    onChange={(e) => setNewAssignmentNotes(e.target.value)}
                  />
                  <Button onClick={handleAddAssignment}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Staff
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Host Report Tab */}
        <TabsContent value="host" className="space-y-4">
          {/* Host Report Step Status Card */}
          <Card className="border-l-4 border-l-orange-500">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="h-5 w-5 text-orange-500" />
                  Host Report Step (GHL Sync)
                </div>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={handleForceSyncHostReport}
                  className="text-xs"
                >
                  🔄 Force Sync
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Current Step</p>
                  <Badge 
                    variant={booking.host_report_step ? "default" : "secondary"}
                    className="mt-1"
                  >
                    {booking.host_report_step || "Not Set"}
                  </Badge>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Lifecycle</p>
                  <Badge variant="outline" className="mt-1">
                    {booking.lifecycle_status}
                  </Badge>
                </div>
              </div>
              {!booking.host_report_step && (
                <p className="text-xs text-muted-foreground mt-2">
                  Click "Force Sync" to trigger host_report_step calculation and GHL sync
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                📝 Guest Post-Event Report
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!hostReport ? (
                <div className="text-center py-8 bg-muted/30 rounded-lg">
                  <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                  <p className="text-muted-foreground font-medium">No report submitted yet</p>
                  <p className="text-sm text-muted-foreground">The guest will submit this after their event</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Status and Timing */}
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Status</label>
                      <Select
                        value={hostReport.status}
                        onValueChange={(value) =>
                          updateHostReport.mutate({
                            id: hostReport.id,
                            bookingId: id!,
                            updates: {
                              status: value,
                              reviewed_at: new Date().toISOString(),
                            },
                          })
                        }
                      >
                        <SelectTrigger className="mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="submitted">📥 Submitted</SelectItem>
                          <SelectItem value="approved">✅ Approved</SelectItem>
                          <SelectItem value="rejected">❌ Rejected</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Submitted</label>
                      <p className="mt-2 font-medium">{format(new Date(hostReport.submitted_at), "PPp")}</p>
                    </div>
                    {hostReport.reviewed_at && (
                      <div>
                        <label className="text-sm font-medium text-muted-foreground">Reviewed</label>
                        <p className="mt-2">{format(new Date(hostReport.reviewed_at), "PPp")}</p>
                      </div>
                    )}
                  </div>

                  {/* Guest Info */}
                  {(hostReport.guest_name || hostReport.guest_email || hostReport.guest_phone) && (
                    <div className="border-t pt-4">
                      <label className="text-sm font-medium text-muted-foreground mb-3 block">Guest Information</label>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {hostReport.guest_name && (
                          <div className="flex items-center gap-2">
                            <User className="h-4 w-4 text-muted-foreground" />
                            <span>{hostReport.guest_name}</span>
                          </div>
                        )}
                        {hostReport.guest_email && (
                          <div className="flex items-center gap-2">
                            <Mail className="h-4 w-4 text-muted-foreground" />
                            <span>{hostReport.guest_email}</span>
                          </div>
                        )}
                        {hostReport.guest_phone && (
                          <div className="flex items-center gap-2">
                            <Phone className="h-4 w-4 text-muted-foreground" />
                            <span>{hostReport.guest_phone}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Confirmation Checklist */}
                  <div className="border-t pt-4">
                    <label className="text-sm font-medium text-muted-foreground mb-3 block">Guest Confirmations</label>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div className={`flex items-center gap-2 p-2 rounded ${hostReport.guest_confirm_area_clean ? 'bg-green-100' : 'bg-muted'}`}>
                        <div className={`w-4 h-4 rounded-full flex-shrink-0 ${hostReport.guest_confirm_area_clean ? 'bg-green-500' : 'bg-muted-foreground/30'}`} />
                        <span className="text-sm">Area Clean</span>
                      </div>
                      <div className={`flex items-center gap-2 p-2 rounded ${hostReport.guest_confirm_trash_bagged ? 'bg-green-100' : 'bg-muted'}`}>
                        <div className={`w-4 h-4 rounded-full flex-shrink-0 ${hostReport.guest_confirm_trash_bagged ? 'bg-green-500' : 'bg-muted-foreground/30'}`} />
                        <span className="text-sm">Trash Bagged</span>
                      </div>
                      <div className={`flex items-center gap-2 p-2 rounded ${hostReport.guest_confirm_bathrooms_ok ? 'bg-green-100' : 'bg-muted'}`}>
                        <div className={`w-4 h-4 rounded-full flex-shrink-0 ${hostReport.guest_confirm_bathrooms_ok ? 'bg-green-500' : 'bg-muted-foreground/30'}`} />
                        <span className="text-sm">Bathrooms OK</span>
                      </div>
                      <div className={`flex items-center gap-2 p-2 rounded ${hostReport.guest_confirm_door_closed ? 'bg-green-100' : 'bg-muted'}`}>
                        <div className={`w-4 h-4 rounded-full flex-shrink-0 ${hostReport.guest_confirm_door_closed ? 'bg-green-500' : 'bg-muted-foreground/30'}`} />
                        <span className="text-sm">Door Closed</span>
                      </div>
                    </div>
                  </div>

                  {/* Issues */}
                  {hostReport.has_issue && (
                    <div className="border-t pt-4">
                      <label className="text-sm font-medium text-destructive mb-2 block">⚠️ Issue Reported</label>
                      <p className="text-sm bg-destructive/10 p-3 rounded-lg border border-destructive/20">
                        {hostReport.issue_description || "No description provided"}
                      </p>
                    </div>
                  )}

                  {/* Notes */}
                  {hostReport.notes && (
                    <div className="border-t pt-4">
                      <label className="text-sm font-medium text-muted-foreground">Additional Notes</label>
                      <p className="mt-1 bg-muted/50 p-3 rounded">{hostReport.notes}</p>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Associated Review */}
          {reviews && reviews.length > 0 && (
            <Card className="border-2 border-yellow-200 bg-yellow-50/30">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-yellow-800">
                  <Star className="h-5 w-5 fill-yellow-500 text-yellow-500" />
                  ⭐ Guest Review
                </CardTitle>
              </CardHeader>
              <CardContent>
                {reviews.map((review) => (
                  <div key={review.id} className="space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <Star
                            key={i}
                            className={`h-6 w-6 ${i < review.rating ? "fill-yellow-400 text-yellow-400" : "text-muted"}`}
                          />
                        ))}
                      </div>
                      <Badge className="bg-yellow-100 text-yellow-800">{review.rating}/5</Badge>
                    </div>
                    {review.comment && (
                      <p className="text-sm bg-background p-4 rounded-lg italic border">
                        "{review.comment}"
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {review.reviewer_name && `By ${review.reviewer_name} • `}
                      {format(new Date(review.created_at), "PPp")}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Reviews Tab */}
        <TabsContent value="reviews">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Star className="h-5 w-5" />
                ⭐ Reviews
              </CardTitle>
            </CardHeader>
            <CardContent>
              {reviews?.length === 0 ? (
                <div className="text-center py-8 bg-muted/30 rounded-lg">
                  <Star className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                  <p className="text-muted-foreground font-medium">No reviews yet</p>
                  <p className="text-sm text-muted-foreground">Reviews will appear here after the guest submits their post-event report</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {reviews?.map((review) => (
                    <div key={review.id} className="p-4 border rounded-lg bg-card hover:bg-accent/30 transition-colors">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">{review.source}</Badge>
                          <span className="font-medium">{review.reviewer_name || "Anonymous"}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          {Array.from({ length: 5 }).map((_, i) => (
                            <Star
                              key={i}
                              className={`h-5 w-5 ${i < review.rating ? "fill-yellow-400 text-yellow-400" : "text-muted"}`}
                            />
                          ))}
                        </div>
                      </div>
                      {review.comment && (
                        <p className="text-muted-foreground italic">"{review.comment}"</p>
                      )}
                      <p className="text-xs text-muted-foreground mt-3">
                        {format(new Date(review.created_at), "PPp")}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Attachments Tab */}
        <TabsContent value="attachments">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Paperclip className="h-5 w-5" />
                📎 Attachments
              </CardTitle>
            </CardHeader>
            <CardContent>
              {attachments?.length === 0 ? (
                <div className="text-center py-8 bg-muted/30 rounded-lg">
                  <Paperclip className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                  <p className="text-muted-foreground font-medium">No attachments yet</p>
                  <p className="text-sm text-muted-foreground">Files uploaded by guests or staff will appear here</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {["contract", "host_post_event", "cleaning_before", "cleaning_after", "maintenance", "other"].map(
                    (category) => {
                      const categoryAttachments = attachments?.filter((a) => a.category === category);
                      if (!categoryAttachments?.length) return null;
                      return (
                        <div key={category}>
                          <h4 className="font-medium mb-3 capitalize text-muted-foreground">
                            {category.replace(/_/g, " ")}
                          </h4>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            {categoryAttachments.map((attachment) => (
                              <div
                                key={attachment.id}
                                className="p-3 border rounded-lg bg-card hover:bg-accent/50 transition-colors cursor-pointer"
                                title={attachment.filename}
                              >
                                <Paperclip className="h-4 w-4 text-muted-foreground mb-2" />
                                <p className="text-sm truncate">{attachment.filename}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    }
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
