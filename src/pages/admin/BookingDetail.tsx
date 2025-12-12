import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useParams, Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
  MessageSquare,
  Sparkles,
  FileText,
  Star,
  Wrench,
  Paperclip,
  Plus,
  Trash2
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import {
  useBooking,
  useBookingEvents,
  useBookingStaffAssignments,
  useBookingCleaningReports,
  useBookingHostReports,
  useBookingReviews,
  useBookingMaintenanceTickets,
  useBookingAttachments,
  useStaffMembers,
  useUpdateBooking,
  useCreateBookingEvent,
  useCreateStaffAssignment,
  useDeleteStaffAssignment,
  useCreateCleaningReport,
  useUpdateCleaningReport,
  useUpdateHostReport,
  useCreateMaintenanceTicket,
  useUpdateMaintenanceTicket,
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

const eventTypes = [
  "confirmation_sent",
  "reminder_72h",
  "reminder_24h",
  "reminder_3h",
  "post_event_link_sent",
  "review_request_sent",
  "call_received",
  "call_transferred",
];

const assignmentRoles = ["manager_on_duty", "support", "door", "cleaner", "other"];

export default function BookingDetail() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();

  const { data: booking, isLoading } = useBooking(id!);
  const { data: events } = useBookingEvents(id!);
  const { data: assignments } = useBookingStaffAssignments(id!);
  const { data: cleaningReports } = useBookingCleaningReports(id!);
  const { data: hostReports } = useBookingHostReports(id!);
  const { data: reviews } = useBookingReviews(id!);
  const { data: maintenanceTickets } = useBookingMaintenanceTickets(id!);
  const { data: attachments } = useBookingAttachments(id!);
  const { data: staffMembers } = useStaffMembers({ isActive: true });

  const updateBooking = useUpdateBooking();
  const createEvent = useCreateBookingEvent();
  const createAssignment = useCreateStaffAssignment();
  const deleteAssignment = useDeleteStaffAssignment();
  const createCleaningReport = useCreateCleaningReport();
  const updateCleaningReport = useUpdateCleaningReport();
  const updateHostReport = useUpdateHostReport();
  const createMaintenanceTicket = useCreateMaintenanceTicket();
  const updateMaintenanceTicket = useUpdateMaintenanceTicket();

  // Form states
  const [newAssignmentStaff, setNewAssignmentStaff] = useState("");
  const [newAssignmentRole, setNewAssignmentRole] = useState("");
  const [newAssignmentNotes, setNewAssignmentNotes] = useState("");
  const [newTicketTitle, setNewTicketTitle] = useState("");
  const [newTicketArea, setNewTicketArea] = useState("");
  const [newTicketPriority, setNewTicketPriority] = useState("medium");

  // Confirmation checklist states
  const [scheduleAvailability, setScheduleAvailability] = useState(false);
  const [staffingAvailability, setStaffingAvailability] = useState(false);
  const [eventTypeConflicts, setEventTypeConflicts] = useState(false);

  // Post-event close state
  const [reviewReceived, setReviewReceived] = useState(false);

  if (isLoading) {
    return <div className="p-8 text-center text-muted-foreground">Loading booking...</div>;
  }

  if (!booking) {
    return <div className="p-8 text-center text-muted-foreground">Booking not found</div>;
  }

  const handleStatusChange = async (newStatus: string) => {
    try {
      await updateBooking.mutateAsync({ id: booking.id, updates: { lifecycle_status: newStatus } });
      toast({ title: "Status updated" });
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
      // Sync to GHL so it can re-evaluate workflow conditions
      await supabase.functions.invoke("sync-to-ghl", {
        body: { booking_id: booking.id },
      });
      toast({ title: "Pre-event checklist completed and synced to GHL" });
    } catch {
      toast({ title: "Failed to update", variant: "destructive" });
    }
  };

  // Handle confirmation checklist - save timestamp when all 3 are checked (GHL handles the status change)
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

    // When all 3 are checked, set pre_event_ready to true, sync to GHL, and schedule balance payment
    if (newSchedule && newStaffing && newConflicts) {
      try {
        await updateBooking.mutateAsync({
          id: booking.id,
          updates: { pre_event_ready: "true" },
        });
        // Sync to GHL so it can re-evaluate workflow conditions
        await supabase.functions.invoke("sync-to-ghl", {
          body: { booking_id: booking.id },
        });
        // Schedule or create balance payment link based on event proximity
        const balanceResult = await supabase.functions.invoke("schedule-balance-payment", {
          body: { booking_id: booking.id },
        });
        console.log("Balance payment scheduling result:", balanceResult.data);
        toast({ title: "Checklist completed and synced to GHL" });
      } catch {
        toast({ title: "Failed to save checklist", variant: "destructive" });
      }
    }
  };

  // Handle review received checkbox - auto-close when checked
  const handleReviewReceivedCheck = async (checked: boolean) => {
    setReviewReceived(checked);
    if (checked) {
      try {
        await updateBooking.mutateAsync({
          id: booking.id,
          updates: { lifecycle_status: "closed_review_complete" },
        });
        toast({ title: "Booking closed" });
      } catch {
        toast({ title: "Failed to close booking", variant: "destructive" });
      }
    }
  };

  const handleLogEvent = async (eventType: string) => {
    try {
      await createEvent.mutateAsync({
        booking_id: booking.id,
        event_type: eventType,
        channel: "system",
        metadata: { logged_at: new Date().toISOString() },
      });
      toast({ title: `Event "${eventType}" logged` });
    } catch {
      toast({ title: "Failed to log event", variant: "destructive" });
    }
  };

  const handleAddAssignment = async () => {
    if (!newAssignmentStaff || !newAssignmentRole) return;
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
      toast({ title: "Assignment added" });
    } catch {
      toast({ title: "Failed to add assignment", variant: "destructive" });
    }
  };

  const handleDeleteAssignment = async (assignmentId: string) => {
    try {
      await deleteAssignment.mutateAsync({ id: assignmentId, bookingId: booking.id });
      toast({ title: "Assignment removed" });
    } catch {
      toast({ title: "Failed to remove assignment", variant: "destructive" });
    }
  };

  const handleCreateCleaningReport = async () => {
    try {
      await createCleaningReport.mutateAsync({ booking_id: booking.id });
      toast({ title: "Cleaning report created" });
    } catch {
      toast({ title: "Failed to create cleaning report", variant: "destructive" });
    }
  };

  const handleCreateMaintenanceTicket = async () => {
    if (!newTicketTitle) return;
    try {
      await createMaintenanceTicket.mutateAsync({
        booking_id: booking.id,
        title: newTicketTitle,
        venue_area: newTicketArea || null,
        priority: newTicketPriority,
        status: "open",
        issue_type: null,
        description: null,
        reported_by_role: "admin",
      });
      setNewTicketTitle("");
      setNewTicketArea("");
      toast({ title: "Maintenance ticket created" });
    } catch {
      toast({ title: "Failed to create ticket", variant: "destructive" });
    }
  };

  const cleaningReport = cleaningReports?.[0];
  const hostReport = hostReports?.[0];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link to="/admin/bookings">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-foreground">{booking.full_name}</h1>
          <p className="text-muted-foreground">
            {format(new Date(booking.event_date), "MMMM d, yyyy")} • {booking.event_type}
          </p>
        </div>
        <Select value={booking.lifecycle_status} onValueChange={handleStatusChange}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {lifecycleStatuses.map((status) => (
              <SelectItem key={status} value={status}>
                {status.replace(/_/g, " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="checklist">Pre-Event</TabsTrigger>
          <TabsTrigger value="staff">Staff</TabsTrigger>
          <TabsTrigger value="events">Events</TabsTrigger>
          <TabsTrigger value="cleaning">Cleaning</TabsTrigger>
          <TabsTrigger value="host">Host Report</TabsTrigger>
          <TabsTrigger value="reviews">Reviews</TabsTrigger>
          <TabsTrigger value="maintenance">Maintenance</TabsTrigger>
          <TabsTrigger value="attachments">Files</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="h-5 w-5" />
                  Contact Info
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p><strong>Name:</strong> {booking.full_name}</p>
                <p><strong>Email:</strong> {booking.email}</p>
                <p><strong>Phone:</strong> {booking.phone}</p>
                {booking.company && <p><strong>Company:</strong> {booking.company}</p>}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="h-5 w-5" />
                  Event Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p><strong>Date:</strong> {format(new Date(booking.event_date), "MMMM d, yyyy")}</p>
                <p><strong>Time:</strong> {booking.start_time?.slice(0, 5) || "-"} - {booking.end_time?.slice(0, 5) || "-"}</p>
                <p><strong>Type:</strong> {booking.event_type} {booking.event_type_other && `(${booking.event_type_other})`}</p>
                <p><strong>Booking Type:</strong> {booking.booking_type}</p>
                <p><strong>Guests:</strong> {booking.number_of_guests}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Services
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p><strong>Package:</strong> {booking.package}</p>
                <p><strong>Setup/Breakdown:</strong> {booking.setup_breakdown ? "Yes" : "No"}</p>
                <p><strong>Tablecloths:</strong> {booking.tablecloths ? `Yes (${booking.tablecloth_quantity})` : "No"}</p>
                {booking.client_notes && <p><strong>Notes:</strong> {booking.client_notes}</p>}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <DollarSign className="h-5 w-5" />
                  Financials
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p><strong>Base Rental:</strong> ${Number(booking.base_rental).toLocaleString()}</p>
                <p><strong>Package Cost:</strong> ${Number(booking.package_cost).toLocaleString()}</p>
                <p><strong>Cleaning Fee:</strong> ${Number(booking.cleaning_fee).toLocaleString()}</p>
                <p><strong>Optional Services:</strong> ${Number(booking.optional_services).toLocaleString()}</p>
                <p><strong>Taxes/Fees:</strong> ${Number(booking.taxes_fees).toLocaleString()}</p>
                <hr className="my-2" />
                <p className="font-bold"><strong>Total:</strong> ${Number(booking.total_amount).toLocaleString()}</p>
                <p><strong>Deposit:</strong> ${Number(booking.deposit_amount).toLocaleString()}</p>
                <p><strong>Balance:</strong> ${Number(booking.balance_amount).toLocaleString()}</p>
                <Badge>{booking.payment_status}</Badge>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Pre-Event Checklist Tab */}
        <TabsContent value="checklist" className="space-y-4">
          {/* Confirmation Checklist - shown when pending */}
          {booking.lifecycle_status === "pending" && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CheckCircle className="h-5 w-5" />
                  Confirmation Checklist
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Complete all items to confirm this booking
                </p>
                <div className="space-y-3">
                  <div className="flex items-center space-x-3">
                    <Checkbox
                      id="schedule"
                      checked={scheduleAvailability}
                      onCheckedChange={(checked) =>
                        handleConfirmationCheck("schedule", checked as boolean)
                      }
                    />
                    <label htmlFor="schedule" className="text-sm font-medium cursor-pointer">
                      Schedule Availability
                    </label>
                  </div>
                  <div className="flex items-center space-x-3">
                    <Checkbox
                      id="staffing"
                      checked={staffingAvailability}
                      onCheckedChange={(checked) =>
                        handleConfirmationCheck("staffing", checked as boolean)
                      }
                    />
                    <label htmlFor="staffing" className="text-sm font-medium cursor-pointer">
                      Staffing Availability
                    </label>
                  </div>
                  <div className="flex items-center space-x-3">
                    <Checkbox
                      id="conflicts"
                      checked={eventTypeConflicts}
                      onCheckedChange={(checked) =>
                        handleConfirmationCheck("conflicts", checked as boolean)
                      }
                    />
                    <label htmlFor="conflicts" className="text-sm font-medium cursor-pointer">
                      Event Type Conflicts (No conflicts found)
                    </label>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Post-Event Close - shown when post_event */}
          {booking.lifecycle_status === "post_event" && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Star className="h-5 w-5" />
                  Close Booking
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center space-x-3">
                  <Checkbox
                    id="reviewReceived"
                    checked={reviewReceived}
                    onCheckedChange={(checked) =>
                      handleReviewReceivedCheck(checked as boolean)
                    }
                  />
                  <label htmlFor="reviewReceived" className="text-sm font-medium cursor-pointer">
                    Guest review has been received
                  </label>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Pre-Event Ready - shown for other statuses */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5" />
                Pre-Event Checklist
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4">
                <Badge variant={booking.pre_event_ready === "true" ? "default" : "secondary"}>
                  {booking.pre_event_ready === "true" ? "Ready" : "Not Ready"}
                </Badge>
              </div>
              {booking.pre_event_ready !== "true" && (
                <Button onClick={handleMarkPreEventReady}>
                  Mark Pre-Event Checklist as Completed
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
                Staff Assignments
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {assignments?.length === 0 ? (
                <p className="text-muted-foreground">No staff assigned yet</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Staff Member</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Assignment</TableHead>
                      <TableHead>Notes</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {assignments?.map((assignment) => (
                      <TableRow key={assignment.id}>
                        <TableCell>{assignment.staff_member?.full_name}</TableCell>
                        <TableCell>{assignment.staff_member?.role}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{assignment.assignment_role}</Badge>
                        </TableCell>
                        <TableCell>{assignment.notes || "-"}</TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDeleteAssignment(assignment.id)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 pt-4 border-t">
                <Select value={newAssignmentStaff} onValueChange={setNewAssignmentStaff}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select staff" />
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
                  Add
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Communication Events Tab */}
        <TabsContent value="events">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5" />
                Communication Events
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {eventTypes.map((type) => (
                  <Button key={type} variant="outline" size="sm" onClick={() => handleLogEvent(type)}>
                    Log {type.replace(/_/g, " ")}
                  </Button>
                ))}
              </div>

              {events?.length === 0 ? (
                <p className="text-muted-foreground">No events logged yet</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Event Type</TableHead>
                      <TableHead>Channel</TableHead>
                      <TableHead>Metadata</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {events?.map((event) => (
                      <TableRow key={event.id}>
                        <TableCell>{format(new Date(event.created_at), "PPp")}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{event.event_type}</Badge>
                        </TableCell>
                        <TableCell>{event.channel || "-"}</TableCell>
                        <TableCell className="max-w-xs truncate">
                          {event.metadata ? JSON.stringify(event.metadata) : "-"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Cleaning Tab */}
        <TabsContent value="cleaning">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5" />
                Cleaning
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!cleaningReport ? (
                <div>
                  <p className="text-muted-foreground mb-4">No cleaning report exists for this booking.</p>
                  <Button onClick={handleCreateCleaningReport}>Create Cleaning Report</Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <label className="text-sm font-medium">Status</label>
                      <Select
                        value={cleaningReport.status}
                        onValueChange={(value) =>
                          updateCleaningReport.mutate({ id: cleaningReport.id, bookingId: id!, updates: { status: value } })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="pending">Pending</SelectItem>
                          <SelectItem value="in_progress">In Progress</SelectItem>
                          <SelectItem value="completed">Completed</SelectItem>
                          <SelectItem value="approved">Approved</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="text-sm font-medium">Cleaner</label>
                      <Select
                        value={cleaningReport.cleaner_id || ""}
                        onValueChange={(value) =>
                          updateCleaningReport.mutate({ id: cleaningReport.id, bookingId: id!, updates: { cleaner_id: value } })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Assign cleaner" />
                        </SelectTrigger>
                        <SelectContent>
                          {staffMembers?.filter((s) => s.role === "cleaner").map((staff) => (
                            <SelectItem key={staff.id} value={staff.id}>
                              {staff.full_name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                    {["floors_clean", "restrooms_clean", "trash_removed", "surfaces_clean", "damage_found"].map((field) => (
                      <div key={field} className="flex items-center gap-2">
                        <Checkbox
                          checked={cleaningReport[field as keyof typeof cleaningReport] as boolean || false}
                          onCheckedChange={(checked) =>
                            updateCleaningReport.mutate({
                              id: cleaningReport.id,
                              bookingId: id!,
                              updates: { [field]: checked },
                            })
                          }
                        />
                        <label className="text-sm">{field.replace(/_/g, " ")}</label>
                      </div>
                    ))}
                  </div>

                  {cleaningReport.damage_found && (
                    <Textarea
                      placeholder="Damage notes..."
                      value={cleaningReport.damage_notes || ""}
                      onChange={(e) =>
                        updateCleaningReport.mutate({
                          id: cleaningReport.id,
                          bookingId: id!,
                          updates: { damage_notes: e.target.value },
                        })
                      }
                    />
                  )}

                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={() =>
                        updateCleaningReport.mutate({
                          id: cleaningReport.id,
                          bookingId: id!,
                          updates: { started_at: new Date().toISOString(), status: "in_progress" },
                        })
                      }
                    >
                      Mark Started
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() =>
                        updateCleaningReport.mutate({
                          id: cleaningReport.id,
                          bookingId: id!,
                          updates: { completed_at: new Date().toISOString(), status: "completed" },
                        })
                      }
                    >
                      Mark Completed
                    </Button>
                    <Button
                      onClick={() =>
                        updateCleaningReport.mutate({
                          id: cleaningReport.id,
                          bookingId: id!,
                          updates: { status: "approved" },
                        })
                      }
                    >
                      Approve
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Host Report Tab */}
        <TabsContent value="host">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Host Report
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!hostReport ? (
                <p className="text-muted-foreground">No host report submitted yet.</p>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium">Status</label>
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
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="submitted">Submitted</SelectItem>
                          <SelectItem value="approved">Approved</SelectItem>
                          <SelectItem value="rejected">Rejected</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="text-sm font-medium">Submitted At</label>
                      <p>{format(new Date(hostReport.submitted_at), "PPp")}</p>
                    </div>
                  </div>
                  {hostReport.notes && (
                    <div>
                      <label className="text-sm font-medium">Notes</label>
                      <p className="mt-1">{hostReport.notes}</p>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Reviews Tab */}
        <TabsContent value="reviews">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Star className="h-5 w-5" />
                Reviews
              </CardTitle>
            </CardHeader>
            <CardContent>
              {reviews?.length === 0 ? (
                <p className="text-muted-foreground">No reviews yet.</p>
              ) : (
                <div className="space-y-4">
                  {reviews?.map((review) => (
                    <div key={review.id} className="p-4 border rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Badge>{review.source}</Badge>
                          <span className="font-medium">{review.reviewer_name || "Anonymous"}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          {Array.from({ length: 5 }).map((_, i) => (
                            <Star
                              key={i}
                              className={`h-4 w-4 ${i < review.rating ? "fill-primary text-primary" : "text-muted"}`}
                            />
                          ))}
                        </div>
                      </div>
                      {review.comment && <p className="text-muted-foreground">{review.comment}</p>}
                      <p className="text-xs text-muted-foreground mt-2">
                        {format(new Date(review.created_at), "PPp")}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Maintenance Tab */}
        <TabsContent value="maintenance">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wrench className="h-5 w-5" />
                Maintenance Tickets
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {maintenanceTickets?.length === 0 ? (
                <p className="text-muted-foreground">No maintenance tickets.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Title</TableHead>
                      <TableHead>Area</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {maintenanceTickets?.map((ticket) => (
                      <TableRow key={ticket.id}>
                        <TableCell>{ticket.title}</TableCell>
                        <TableCell>{ticket.venue_area || "-"}</TableCell>
                        <TableCell>
                          <Badge variant={ticket.priority === "high" ? "destructive" : "secondary"}>
                            {ticket.priority}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Select
                            value={ticket.status}
                            onValueChange={(value) =>
                              updateMaintenanceTicket.mutate({
                                id: ticket.id,
                                updates: {
                                  status: value,
                                  resolved_at: value === "resolved" ? new Date().toISOString() : null,
                                },
                              })
                            }
                          >
                            <SelectTrigger className="w-32">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="open">Open</SelectItem>
                              <SelectItem value="in_progress">In Progress</SelectItem>
                              <SelectItem value="resolved">Resolved</SelectItem>
                              <SelectItem value="dismissed">Dismissed</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>{format(new Date(ticket.created_at), "PP")}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 pt-4 border-t">
                <Input
                  placeholder="Ticket title"
                  value={newTicketTitle}
                  onChange={(e) => setNewTicketTitle(e.target.value)}
                />
                <Input
                  placeholder="Venue area"
                  value={newTicketArea}
                  onChange={(e) => setNewTicketArea(e.target.value)}
                />
                <Select value={newTicketPriority} onValueChange={setNewTicketPriority}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectContent>
                </Select>
                <Button onClick={handleCreateMaintenanceTicket}>
                  <Plus className="h-4 w-4 mr-2" />
                  Create Ticket
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Attachments Tab */}
        <TabsContent value="attachments">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Paperclip className="h-5 w-5" />
                Attachments
              </CardTitle>
            </CardHeader>
            <CardContent>
              {attachments?.length === 0 ? (
                <p className="text-muted-foreground">No attachments yet.</p>
              ) : (
                <div className="space-y-4">
                  {["contract", "host_post_event", "cleaning_before", "cleaning_after", "maintenance", "other"].map(
                    (category) => {
                      const categoryAttachments = attachments?.filter((a) => a.category === category);
                      if (!categoryAttachments?.length) return null;
                      return (
                        <div key={category}>
                          <h4 className="font-medium mb-2 capitalize">{category.replace(/_/g, " ")}</h4>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                            {categoryAttachments.map((attachment) => (
                              <div
                                key={attachment.id}
                                className="p-2 border rounded text-sm truncate"
                                title={attachment.filename}
                              >
                                {attachment.filename}
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
