import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useParams, Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { 
  ArrowLeft, 
  User, 
  Calendar as CalendarIcon, 
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
  CreditCard,
  AlertTriangle,
  ChevronDown,
  ChevronUp
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format, parseISO, isBefore } from "date-fns";
import {
  useBooking,
  useBookingStaffAssignments,
  useBookingHostReports,
  useBookingReviews,
  useBookingAttachments,
  useBookingCleaningReports,
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

const assignmentRoles = ["Production", "Custodial", "Assistant"];

export default function BookingDetail() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();

  const { data: booking, isLoading } = useBooking(id!);
  const { data: assignments } = useBookingStaffAssignments(id!);
  const { data: hostReports } = useBookingHostReports(id!);
  const { data: cleaningReports } = useBookingCleaningReports(id!);
  const { data: reviews } = useBookingReviews(id!);
  const { data: attachments } = useBookingAttachments(id!);
  const { data: staffMembers } = useStaffMembers({ isActive: true });

  const updateBooking = useUpdateBooking();
  const createAssignment = useCreateStaffAssignment();
  const deleteAssignment = useDeleteStaffAssignment();
  const updateHostReport = useUpdateHostReport();

  // Report expand states
  const [isGuestReportExpanded, setIsGuestReportExpanded] = useState(false);
  const [isCleaningReportExpanded, setIsCleaningReportExpanded] = useState(false);

  // Form states
  const [newAssignmentStaff, setNewAssignmentStaff] = useState("");
  const [newAssignmentRole, setNewAssignmentRole] = useState("");
  const [newAssignmentCleaningType, setNewAssignmentCleaningType] = useState<string>("");
  const [hasCelebrationSurcharge, setHasCelebrationSurcharge] = useState(false);
  const [celebrationSurchargeAmount, setCelebrationSurchargeAmount] = useState<string>("");

  // Reschedule state
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [rescheduleData, setRescheduleData] = useState({
    date: "",
    // booking_type removed - never changes
    start_time: "",
    end_time: "",
    reason: "",
  });
  const [rescheduleLoading, setRescheduleLoading] = useState(false);
  const [rescheduleInitialized, setRescheduleInitialized] = useState(false);

  // Confirmation checklist states
  const [scheduleAvailability, setScheduleAvailability] = useState(false);
  const [staffingAvailability, setStaffingAvailability] = useState(false);
  const [eventTypeConflicts, setEventTypeConflicts] = useState(false);

  // Post-event close state
  const [reviewReceived, setReviewReceived] = useState(false);

  // Manual deposit override modal state
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [depositOverrideLoading, setDepositOverrideLoading] = useState(false);
  const [manualPaymentIntentId, setManualPaymentIntentId] = useState("");

  // Cancellation state
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [manualCustomerId, setManualCustomerId] = useState("");
  const [manualSessionId, setManualSessionId] = useState("");

  // Production configuration state (for external bookings)
  const [showProductionDialog, setShowProductionDialog] = useState(false);
  const [productionPackage, setProductionPackage] = useState<string>("none");
  const [productionStartTime, setProductionStartTime] = useState("");
  const [productionEndTime, setProductionEndTime] = useState("");
  const [productionLoading, setProductionLoading] = useState(false);

  // Validation for Stripe IDs
  const validateStripeId = (value: string, prefix: string) => {
    if (!value) return true; // Empty is allowed
    return value.startsWith(prefix);
  };

  const piValid = validateStripeId(manualPaymentIntentId, "pi_");
  const cusValid = validateStripeId(manualCustomerId, "cus_");
  const csValid = validateStripeId(manualSessionId, "cs_");
  const allValid = piValid && cusValid && csValid;

  const handleManualDepositOverride = async () => {
    if (!allValid) return;

    setDepositOverrideLoading(true);
    try {
      const updates: Record<string, unknown> = {
        payment_status: "deposit_paid",
        deposit_paid_at: new Date().toISOString(),
      };

      if (manualPaymentIntentId) {
        updates.stripe_payment_intent_id = manualPaymentIntentId;
      }
      // Note: stripe_customer_id column doesn't exist in schema, skip it

      const { error } = await supabase
        .from("bookings")
        .update(updates)
        .eq("id", booking.id);

      if (error) throw error;

      toast({ title: "✅ Deposit marked as paid" });
      setShowDepositModal(false);
      setManualPaymentIntentId("");
      setManualCustomerId("");
      setManualSessionId("");
      
      // Refetch booking data
      window.location.reload();
    } catch (error) {
      console.error("Manual deposit override failed:", error);
      toast({
        title: "Failed to update payment status",
        description: String(error),
        variant: "destructive",
      });
    } finally {
      setDepositOverrideLoading(false);
    }
  };

  // Initialize reschedule data when booking loads
  useEffect(() => {
    if (booking && !rescheduleInitialized) {
      setRescheduleData({
        date: booking.event_date,
        // booking_type removed - never changes
        start_time: booking.start_time || "",
        end_time: booking.end_time || "",
        reason: "",
      });
      setRescheduleInitialized(true);
    }
  }, [booking, rescheduleInitialized]);

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

  // Helper to trigger automation ONLY on false->true transition
  const triggerAutomationIfNeeded = async (wasPreEventReady: boolean) => {
    if (!wasPreEventReady) {
      console.log("Triggering booking automation (pre_event_ready: false -> true)");
      const { data, error } = await supabase.functions.invoke("trigger-booking-automation", {
        body: { booking_id: booking.id },
      });
      if (error) {
        console.error("trigger-booking-automation failed:", error);
        toast({ title: "⚠️ Automation scheduling may have failed", variant: "destructive" });
      } else {
        console.log("trigger-booking-automation OK:", data);
      }
    } else {
      console.log("Skipping automation trigger - already pre_event_ready=true");
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    try {
      const wasPreEventReady = booking.pre_event_ready === "true";
      
      await updateBooking.mutateAsync({ id: booking.id, updates: { lifecycle_status: newStatus } });
      
      // If changing to pre_event_ready, trigger full automation
      if (newStatus === "pre_event_ready") {
        await triggerAutomationIfNeeded(wasPreEventReady);
      }
      
      // Always sync to GHL on status change
      await supabase.functions.invoke("sync-to-ghl", {
        body: { booking_id: booking.id },
      });
      
      toast({ title: "Status updated successfully" });
    } catch {
      toast({ title: "Failed to update status", variant: "destructive" });
    }
  };

  const handleMarkPreEventReady = async () => {
    try {
      const wasPreEventReady = booking.pre_event_ready === "true";
      
      await updateBooking.mutateAsync({
        id: booking.id,
        updates: {
          pre_event_ready: "true",
          lifecycle_status: "pre_event_ready",
        },
      });
      
      // Trigger automation only if transitioning from false to true
      await triggerAutomationIfNeeded(wasPreEventReady);
      
      // Always sync to GHL
      await supabase.functions.invoke("sync-to-ghl", {
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
        const wasPreEventReady = booking.pre_event_ready === "true";
        
        await updateBooking.mutateAsync({
          id: booking.id,
          updates: { pre_event_ready: "true" },
        });
        
        // Trigger automation only if transitioning from false to true
        await triggerAutomationIfNeeded(wasPreEventReady);
        
        // Always sync to GHL
        await supabase.functions.invoke("sync-to-ghl", {
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

  const calculatePayrollPreview = () => {
    if (!newAssignmentCleaningType) return 0;
    
    const baseRates: Record<string, number> = {
      touch_up: 40,
      regular: 80,
      deep: 150,
    };
    
    const base = baseRates[newAssignmentCleaningType] || 0;
    const surcharge = hasCelebrationSurcharge ? parseFloat(celebrationSurchargeAmount || "0") : 0;
    
    return base + surcharge;
  };

  const handleAddAssignment = async () => {
    if (!newAssignmentStaff || !newAssignmentRole) {
      toast({ title: "Please select staff and role", variant: "destructive" });
      return;
    }
    
    // Validate cleaning type for Custodial/Assistant
    const selectedStaff = staffMembers?.find(s => s.id === newAssignmentStaff);
    const isCustodialOrAssistant = selectedStaff?.role === 'Custodial' || selectedStaff?.role === 'Assistant';
    
    if (isCustodialOrAssistant && !newAssignmentCleaningType) {
      toast({ 
        title: "Cleaning Type required for Custodial/Assistant staff", 
        variant: "destructive" 
      });
      return;
    }
    
    // Validate celebration surcharge range
    if (hasCelebrationSurcharge) {
      const amount = parseFloat(celebrationSurchargeAmount);
      if (isNaN(amount) || amount < 20 || amount > 70) {
        toast({ 
          title: "Celebration surcharge must be between $20 and $70", 
          variant: "destructive" 
        });
        return;
      }
    }
    
    try {
      const assignmentData: any = {
        booking_id: booking.id,
        staff_id: newAssignmentStaff,
        assignment_role: newAssignmentRole,
      };
      
      // Add cleaning fields if Custodial/Assistant
      if (isCustodialOrAssistant) {
        assignmentData.assignment_type = 'cleaning';
        assignmentData.cleaning_type = newAssignmentCleaningType;
        assignmentData.celebration_surcharge = hasCelebrationSurcharge 
          ? parseFloat(celebrationSurchargeAmount) 
          : 0;
      }
      
      await createAssignment.mutateAsync(assignmentData);
      
      // Reset form
      setNewAssignmentStaff("");
      setNewAssignmentRole("");
      setNewAssignmentCleaningType("");
      setHasCelebrationSurcharge(false);
      setCelebrationSurchargeAmount("");
      
      toast({ title: "Staff assigned and notification sent" });
    } catch (error: any) {
      const errorMessage = error?.message || "Failed to assign staff";
      toast({ title: errorMessage, variant: "destructive" });
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
        body: { booking_id: booking.id, force_host_report_completed: true },
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

  const handleReschedule = async () => {
    setRescheduleLoading(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/reschedule-booking`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session?.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            booking_id: booking.id,
            event_date: rescheduleData.date,
            // booking_type removed - never changes
            start_time: rescheduleData.start_time || null,
            end_time: rescheduleData.end_time || null,
            reason: rescheduleData.reason,
          }),
        }
      );

      const result = await response.json();

      if (!result.ok) {
        // Handle specific error types from the RPC
        const errorMessages: Record<string, string> = {
          date_conflict: "That date is already reserved.",
          daily_conflict: "That date has a full-day rental.",
          time_overlap: "That time overlaps with another booking.",
          times_required: "Start and end times are required for hourly bookings.",
          invalid_time_range: "End time must be after start time.",
          invalid_event_window: "Event window end time must be after start time.",
        };
        
        const message = errorMessages[result.error] || result.message || "Unable to reschedule booking";
        
        toast({
          title: "Cannot reschedule",
          description: result.conflict 
            ? `${message} (${result.conflict.guest || result.conflict.type || ''})` 
            : message,
          variant: "destructive",
        });
        return;
      }

      toast({
        title: "Booking rescheduled successfully!",
        description: "Date updated and all reminders have been adjusted.",
      });

      setRescheduleOpen(false);
      window.location.reload(); // Refetch booking data
    } catch (error) {
      console.error("Reschedule error:", error);
      toast({
        title: "Failed to reschedule booking",
        description: String(error),
        variant: "destructive",
      });
    } finally {
      setRescheduleLoading(false);
    }
  };

  const handleSaveProduction = async () => {
    // Validation: if package is not 'none', times are required
    if (productionPackage !== "none" && (!productionStartTime || !productionEndTime)) {
      toast({
        title: "Missing Information",
        description: "Please specify both start and end times for production",
        variant: "destructive",
      });
      return;
    }

    // Validation: end time must be after start time
    if (productionPackage !== "none" && productionStartTime && productionEndTime) {
      const start = new Date(`2000-01-01T${productionStartTime}`);
      const end = new Date(`2000-01-01T${productionEndTime}`);
      
      if (end <= start) {
        toast({
          title: "Invalid Time Range",
          description: "End time must be after start time",
          variant: "destructive",
        });
        return;
      }

      // Validation: minimum 4 hours
      const hours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
      if (hours < 4) {
        toast({
          title: "Invalid Duration",
          description: "Production package requires a minimum of 4 hours",
          variant: "destructive",
        });
        return;
      }

      // Validation: for hourly bookings, production hours must be within booking hours
      if (booking?.booking_type === "hourly" && booking.start_time && booking.end_time) {
        const bookingStart = new Date(`2000-01-01T${booking.start_time}`);
        const bookingEnd = new Date(`2000-01-01T${booking.end_time}`);
        
        if (start < bookingStart || end > bookingEnd) {
          toast({
            title: "Invalid Time Range",
            description: `Production hours must be within booking time (${booking.start_time.slice(0, 5)} - ${booking.end_time.slice(0, 5)})`,
            variant: "destructive",
          });
          return;
        }
      }
    }

    setProductionLoading(true);
    
    try {
      const updates = {
        package: productionPackage as "none" | "basic" | "led" | "workshop",
        package_start_time: productionPackage === "none" ? null : productionStartTime,
        package_end_time: productionPackage === "none" ? null : productionEndTime,
        package_cost: 0, // Always 0 for external bookings
      };
      
      const { error } = await supabase
        .from("bookings")
        .update(updates)
        .eq("id", booking.id);
      
      if (error) throw error;
      
      toast({
        title: "✓ Production Configuration Updated",
        description: productionPackage === "none" 
          ? "Production removed from this booking" 
          : `${productionPackage.charAt(0).toUpperCase() + productionPackage.slice(1)} package configured`,
      });
      
      setShowProductionDialog(false);
      
      // Refresh booking data
      window.location.reload();
    } catch (error) {
      console.error("Error updating production configuration:", error);
      toast({
        title: "Error",
        description: "Failed to update production configuration",
        variant: "destructive",
      });
    } finally {
      setProductionLoading(false);
    }
  };

  const handleCancelBooking = async () => {
    setIsCancelling(true);
    
    try {
      console.log(`Cancelling booking: ${booking.id}`);
      
      const { data, error } = await supabase.functions.invoke("cancel-booking", {
        body: { booking_id: booking.id },
      });

      if (error) {
        throw new Error(error.message || "Failed to cancel booking");
      }

      if (!data?.ok) {
        throw new Error(data?.error || "Cancellation failed");
      }

      toast({
        title: "Booking Cancelled Successfully",
        description: `Reservation ${booking.reservation_number} has been cancelled. ${data.jobs_deleted || 0} scheduled jobs removed. Guest has been notified.`,
      });

      setShowCancelDialog(false);
      
      // Reload booking data to show updated status
      window.location.reload();
      
    } catch (error) {
      console.error("Cancellation error:", error);
      toast({
        title: "Failed to Cancel Booking",
        description: error instanceof Error ? error.message : "An unknown error occurred",
        variant: "destructive",
      });
    } finally {
      setIsCancelling(false);
    }
  };

  const hostReport = hostReports?.[0];
  const cleaningReport = cleaningReports?.[0];

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
            <CalendarIcon className="h-4 w-4" />
            {format(new Date(booking.event_date + 'T00:00:00'), "EEEE, MM/dd/yyyy")}
            <span className="mx-1">•</span>
            {booking.event_type}
          </p>
          {booking.payment_status === "pending" && (
            <div className="flex items-center gap-2 mt-2 px-3 py-1.5 bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-700 rounded-md w-fit">
              <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400" />
              <span className="text-sm font-semibold text-red-700 dark:text-red-400">LEAD - No Deposit Received</span>
            </div>
          )}
        </div>
        
        {/* Status Selector with visual styling */}
        <div className="flex flex-col items-end gap-2">
          <Badge className={`text-sm px-3 py-1 ${lifecycleColors[booking.lifecycle_status] || ""}`}>
            {lifecycleLabels[booking.lifecycle_status] || booking.lifecycle_status}
          </Badge>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRescheduleOpen(true)}
              disabled={
                booking.status === "cancelled" || booking.status === "completed"
              }
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              Reschedule
            </Button>
            {booking.status !== "completed" && booking.status !== "cancelled" && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setShowCancelDialog(true)}
                disabled={isCancelling}
              >
                <AlertTriangle className="mr-2 h-4 w-4" />
                Cancel Booking
              </Button>
            )}
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
      </div>

      <Tabs defaultValue="review" className="space-y-4">
        <TabsList className="bg-muted/50 p-1">
          <TabsTrigger value="review" className="data-[state=active]:bg-background">
            📋 Review
          </TabsTrigger>
          <TabsTrigger value="checklist" className="data-[state=active]:bg-background">
            ✅ Checklist
          </TabsTrigger>
          <TabsTrigger value="staff" className="data-[state=active]:bg-background">
            👥 Staff
          </TabsTrigger>
          <TabsTrigger value="reports" className="data-[state=active]:bg-background">
            📝 Reports
          </TabsTrigger>
        </TabsList>

        {/* Review Tab */}
        <TabsContent value="review" className="space-y-4">
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
                  <CalendarIcon className="h-5 w-5 text-purple-500" />
                  Event Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Date</p>
                    <p className="font-medium">{format(new Date(booking.event_date + 'T00:00:00'), "MM/dd/yyyy")}</p>
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

            {/* Production Configuration - Only for External Bookings */}
            {booking.booking_origin === "external" && (
              <Card className="border-l-4 border-l-purple-500">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Users className="h-5 w-5 text-purple-500" />
                    Production Configuration
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Configure production package and hours for staff scheduling
                  </p>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Production Package</span>
                    <Badge variant={booking.package !== "none" ? "default" : "secondary"}>
                      {booking.package === "none" ? "No Production" : 
                       booking.package === "basic" ? "Basic ($79/hr)" :
                       booking.package === "led" ? "LED ($99/hr)" :
                       booking.package === "workshop" ? "Workshop ($149/hr)" :
                       booking.package || "None"}
                    </Badge>
                  </div>
                  {booking.package !== "none" && booking.package_start_time && booking.package_end_time && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Production Hours</span>
                      <Badge className="bg-purple-600 text-white flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {booking.package_start_time.slice(0, 5)} - {booking.package_end_time.slice(0, 5)}
                      </Badge>
                    </div>
                  )}
                  <Button 
                    onClick={() => {
                      setProductionPackage(booking.package || "none");
                      setProductionStartTime(booking.package_start_time?.slice(0, 5) || "");
                      setProductionEndTime(booking.package_end_time?.slice(0, 5) || "");
                      setShowProductionDialog(true);
                    }}
                    variant="outline"
                    size="sm"
                    className="w-full"
                  >
                    {booking.package !== "none" ? "Edit Production" : "Configure Production"}
                  </Button>
                </CardContent>
              </Card>
            )}

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
                  {booking.discount_amount && Number(booking.discount_amount) > 0 && (
                    <div className="flex justify-between text-green-600 dark:text-green-400">
                      <span className="text-muted-foreground">
                        Discount {booking.discount_code ? `(${booking.discount_code})` : ''}
                      </span>
                      <span>-${Number(booking.discount_amount).toLocaleString()}</span>
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
                    {booking.deposit_paid_at ? (
                      <>
                        <span className="text-green-600 font-medium">Deposit Paid</span>
                        <span className="text-green-600">${Number(booking.deposit_amount).toLocaleString()}</span>
                      </>
                    ) : (
                      <>
                        <span className="text-amber-600 font-medium">Deposit Due</span>
                        <span className="text-amber-600">${Number(booking.deposit_amount).toLocaleString()}</span>
                      </>
                    )}
                  </div>
                  <div className="flex justify-between text-sm">
                    {booking.balance_paid_at ? (
                      <>
                        <span className="text-green-600 font-medium">Balance Paid</span>
                        <span className="text-green-600">${Number(booking.balance_amount).toLocaleString()}</span>
                      </>
                    ) : (
                      <>
                        <span className="text-muted-foreground">Balance Due</span>
                        <span className="font-medium">${Number(booking.balance_amount).toLocaleString()}</span>
                      </>
                    )}
                  </div>
                </div>

                <div className="pt-3 border-t space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Payment Status</span>
                    <Badge className={`${paymentStatusColors[booking.payment_status] || ""} flex items-center gap-1`}>
                      <CreditCard className="h-3 w-3" />
                      {booking.payment_status.replace(/_/g, " ")}
                    </Badge>
                  </div>
                  
                  {/* Manual deposit override button - only if not already paid */}
                  {booking.payment_status === "pending" && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full text-orange-600 border-orange-300 hover:bg-orange-50"
                      onClick={() => setShowDepositModal(true)}
                    >
                      <AlertTriangle className="h-4 w-4 mr-2" />
                      Manual: Mark Deposit Paid
                    </Button>
                  )}
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
                      <TableHead>Working Hours</TableHead>
                      <TableHead>Cleaning Details</TableHead>
                      <TableHead className="w-[50px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {assignments?.map((assignment) => {
                      const isProduction = assignment.staff_member?.role === "Production";
                      const hasPackage = assignment.booking?.package && assignment.booking.package !== "none";
                      const showProductionHours = isProduction && hasPackage && assignment.booking?.package_start_time && assignment.booking?.package_end_time;
                      
                      return (
                        <TableRow key={assignment.id} className={showProductionHours ? "bg-purple-50 dark:bg-purple-950/20" : ""}>
                          <TableCell className="font-medium">{assignment.staff_member?.full_name}</TableCell>
                          <TableCell>
                            <Badge variant="secondary">{assignment.staff_member?.role}</Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{assignment.assignment_role.replace(/_/g, " ")}</Badge>
                          </TableCell>
                          <TableCell>
                            {showProductionHours ? (
                              <Badge className="bg-purple-600 text-white flex items-center gap-1 w-fit">
                                <span>🎬</span>
                                <span>{assignment.booking.package_start_time.slice(0, 5)} - {assignment.booking.package_end_time.slice(0, 5)}</span>
                              </Badge>
                            ) : (
                              <span className="text-sm text-muted-foreground">
                                {assignment.booking?.start_time?.slice(0, 5)} - {assignment.booking?.end_time?.slice(0, 5)}
                              </span>
                            )}
                          </TableCell>
                          <TableCell>
                            {assignment.cleaning_type ? (
                              <div className="flex flex-col gap-1">
                                <Badge variant="secondary" className="w-fit">
                                  {assignment.cleaning_type === 'touch_up' ? 'Touch-Up ($40)' :
                                   assignment.cleaning_type === 'regular' ? 'Regular ($80)' :
                                   assignment.cleaning_type === 'deep' ? 'Deep ($150)' : '-'}
                                </Badge>
                                {assignment.celebration_surcharge && assignment.celebration_surcharge > 0 && (
                                  <Badge variant="outline" className="text-xs w-fit">
                                    +${assignment.celebration_surcharge} celebration
                                  </Badge>
                                )}
                              </div>
                            ) : <span className="text-muted-foreground">-</span>}
                          </TableCell>
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
                      );
                    })}
                  </TableBody>
                </Table>
              )}

              {/* Add Assignment Form */}
              <div className="pt-4 border-t">
                <p className="text-sm font-medium mb-3">Add New Assignment</p>
                {(() => {
                  const selectedStaffMember = staffMembers?.find(s => s.id === newAssignmentStaff);
                  const isCustodialOrAssistant = selectedStaffMember?.role === 'Custodial' || selectedStaffMember?.role === 'Assistant';
                  
                  return (
                    <div className="space-y-4">
                      {/* Fila 1: Staff + Role */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <Select value={newAssignmentStaff} onValueChange={setNewAssignmentStaff}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select staff member" />
                          </SelectTrigger>
                          <SelectContent>
                            {staffMembers?.map((staff) => (
                              <SelectItem key={staff.id} value={staff.id}>
                                <div className="flex items-center justify-between w-full">
                                  <span>{staff.full_name} ({staff.role})</span>
                                  {staff.email ? (
                                    <Mail className="h-3 w-3 text-green-500 ml-2" />
                                  ) : (
                                    <Mail className="h-3 w-3 text-gray-300 ml-2" />
                                  )}
                                </div>
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
                      </div>
                      
                      {/* Fila 2: Cleaning Type + Celebration + Button (solo si Custodial/Assistant) */}
                      {isCustodialOrAssistant ? (
                        <>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="space-y-2">
                              <Label htmlFor="cleaning-type">Cleaning Type *</Label>
                              <Select value={newAssignmentCleaningType} onValueChange={setNewAssignmentCleaningType}>
                                <SelectTrigger id="cleaning-type">
                                  <SelectValue placeholder="Select cleaning type" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="touch_up">Touch-Up Cleaning: $40</SelectItem>
                                  <SelectItem value="regular">Regular Cleaning: $80</SelectItem>
                                  <SelectItem value="deep">Deep Cleaning: $150</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            
                            <div className="space-y-2">
                              <Label>&nbsp;</Label>
                              <div className="flex flex-col gap-2">
                                <div className="flex items-center space-x-2">
                                  <Checkbox 
                                    id="celebration" 
                                    checked={hasCelebrationSurcharge}
                                    onCheckedChange={(checked) => {
                                      setHasCelebrationSurcharge(checked === true);
                                      if (!checked) setCelebrationSurchargeAmount("");
                                    }}
                                  />
                                  <Label htmlFor="celebration">Add Celebration Surcharge</Label>
                                </div>
                                {hasCelebrationSurcharge && (
                                  <Input
                                    type="number"
                                    min="20"
                                    max="70"
                                    step="5"
                                    placeholder="$20-$70"
                                    value={celebrationSurchargeAmount}
                                    onChange={(e) => setCelebrationSurchargeAmount(e.target.value)}
                                  />
                                )}
                              </div>
                            </div>
                            
                            <div className="space-y-2">
                              <Label>&nbsp;</Label>
                              <Button onClick={handleAddAssignment} className="w-full">
                                <Plus className="h-4 w-4 mr-2" />
                                Add Staff
                              </Button>
                            </div>
                          </div>
                          
                          {/* Preview de Payroll */}
                          {newAssignmentCleaningType && (
                            <div className="bg-muted/50 p-3 rounded-lg border">
                              <div className="flex items-center justify-between">
                                <span className="text-sm font-medium">Estimated Payroll:</span>
                                <span className="text-2xl font-bold">
                                  ${calculatePayrollPreview().toFixed(2)}
                                </span>
                              </div>
                            </div>
                          )}
                        </>
                      ) : (
                        /* Si NO es Custodial/Assistant: Solo botón en fila 2 */
                        <div className="flex justify-end">
                          <Button onClick={handleAddAssignment}>
                            <Plus className="h-4 w-4 mr-2" />
                            Add Staff
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Reports Tab */}
        <TabsContent value="reports" className="space-y-4">
          {/* GHL Sync Status */}
          <Card className="border-l-4 border-l-orange-500">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="h-5 w-5 text-orange-500" />
                  Report Sync Status
                </div>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={handleForceSyncHostReport}
                  className="text-xs"
                >
                  Force Sync
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Guest Report</p>
                  <Badge 
                    variant={hostReport ? "default" : "secondary"}
                    className="mt-1"
                  >
                    {hostReport ? (hostReport.status === 'approved' ? 'Approved' : hostReport.status === 'rejected' ? 'Rejected' : 'Submitted') : 'Pending'}
                  </Badge>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Cleaning Report</p>
                  <Badge 
                    variant={cleaningReport?.status === 'completed' ? "default" : "secondary"}
                    className="mt-1"
                  >
                    {cleaningReport?.status === 'completed' ? 'Completed' : 'Pending'}
                  </Badge>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Lifecycle</p>
                  <Badge variant="outline" className="mt-1">
                    {booking.lifecycle_status}
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Guest Report Section */}
          <Card>
            <CardHeader 
              className="cursor-pointer hover:bg-accent/30 transition-colors rounded-t-lg"
              onClick={() => hostReport && setIsGuestReportExpanded(!isGuestReportExpanded)}
            >
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  Guest Post-Event Report
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={hostReport ? "default" : "secondary"}>
                    {hostReport ? (hostReport.status === 'approved' ? 'Approved' : hostReport.status === 'rejected' ? 'Rejected' : 'Submitted') : 'Pending'}
                  </Badge>
                  {hostReport && (
                    isGuestReportExpanded 
                      ? <ChevronUp className="h-5 w-5 text-muted-foreground" /> 
                      : <ChevronDown className="h-5 w-5 text-muted-foreground" />
                  )}
                </div>
              </CardTitle>
              {hostReport && !isGuestReportExpanded && (
                <p className="text-sm text-muted-foreground mt-1">
                  Submitted {format(new Date(hostReport.submitted_at), "MM/dd/yyyy h:mm a")}
                  {hostReport.guest_name ? ` by ${hostReport.guest_name}` : ''}
                  {hostReport.has_issue ? ' — Issue reported' : ''}
                </p>
              )}
            </CardHeader>
            {!hostReport ? (
              <CardContent>
                <div className="text-center py-8 bg-muted/30 rounded-lg">
                  <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                  <p className="text-muted-foreground font-medium">No report submitted yet</p>
                  <p className="text-sm text-muted-foreground">The guest will submit this after their event</p>
                </div>
              </CardContent>
            ) : isGuestReportExpanded && (
              <CardContent>
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
                          <SelectItem value="submitted">Submitted</SelectItem>
                          <SelectItem value="approved">Approved</SelectItem>
                          <SelectItem value="rejected">Rejected</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Submitted</label>
                      <p className="mt-2 font-medium">{format(new Date(hostReport.submitted_at), "MM/dd/yyyy h:mm a")}</p>
                    </div>
                    {hostReport.reviewed_at && (
                      <div>
                        <label className="text-sm font-medium text-muted-foreground">Reviewed</label>
                        <p className="mt-2">{format(new Date(hostReport.reviewed_at), "MM/dd/yyyy h:mm a")}</p>
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
                      <label className="text-sm font-medium text-destructive mb-2 block">Issue Reported</label>
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
              </CardContent>
            )}
          </Card>

          {/* Cleaning Report Section */}
          <Card>
            <CardHeader 
              className="cursor-pointer hover:bg-accent/30 transition-colors rounded-t-lg"
              onClick={() => cleaningReport && setIsCleaningReportExpanded(!isCleaningReportExpanded)}
            >
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-5 w-5" />
                  Cleaning Report
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={cleaningReport?.status === 'completed' ? "default" : "secondary"}>
                    {cleaningReport?.status === 'completed' ? 'Completed' : 'Pending'}
                  </Badge>
                  {cleaningReport && (
                    isCleaningReportExpanded 
                      ? <ChevronUp className="h-5 w-5 text-muted-foreground" /> 
                      : <ChevronDown className="h-5 w-5 text-muted-foreground" />
                  )}
                </div>
              </CardTitle>
              {cleaningReport && !isCleaningReportExpanded && (
                <p className="text-sm text-muted-foreground mt-1">
                  {cleaningReport.cleaner_name ? `By ${cleaningReport.cleaner_name}` : 'Cleaner not specified'}
                  {cleaningReport.completed_at ? ` — Completed ${format(new Date(cleaningReport.completed_at), "MM/dd/yyyy h:mm a")}` : ''}
                  {cleaningReport.clean_issues_notes ? ' — Maintenance issues reported' : ''}
                </p>
              )}
            </CardHeader>
            {!cleaningReport ? (
              <CardContent>
                <div className="text-center py-8 bg-muted/30 rounded-lg">
                  <CheckCircle className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                  <p className="text-muted-foreground font-medium">No cleaning report submitted yet</p>
                  <p className="text-sm text-muted-foreground">The custodial staff will submit this after the event</p>
                </div>
              </CardContent>
            ) : isCleaningReportExpanded && (
              <CardContent>
                <div className="space-y-6">
                  {/* Cleaner Info & Status */}
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Cleaner</label>
                      <p className="mt-1 font-medium">{cleaningReport.cleaner_name || 'Not specified'}</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Status</label>
                      <div className="mt-1">
                        <Badge variant={cleaningReport.status === 'completed' ? "default" : "secondary"}>
                          {cleaningReport.status === 'completed' ? 'Completed' : cleaningReport.status}
                        </Badge>
                      </div>
                    </div>
                    {cleaningReport.completed_at && (
                      <div>
                        <label className="text-sm font-medium text-muted-foreground">Completed</label>
                        <p className="mt-1">{format(new Date(cleaningReport.completed_at), "MM/dd/yyyy h:mm a")}</p>
                      </div>
                    )}
                  </div>

                  {/* Cleaning Checklist */}
                  <div className="border-t pt-4">
                    <label className="text-sm font-medium text-muted-foreground mb-3 block">Cleaning Checklist</label>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      {[
                        { key: 'clean_check_floors', label: 'Floors Swept/Mopped' },
                        { key: 'clean_check_bathrooms', label: 'Bathrooms Cleaned' },
                        { key: 'clean_check_kitchen', label: 'Kitchen Cleaned' },
                        { key: 'clean_check_trash_removed', label: 'Trash Removed' },
                        { key: 'clean_check_equipment_stored', label: 'Equipment Stored' },
                        { key: 'clean_check_tables_chairs_positioned', label: 'Tables/Chairs Positioned' },
                        { key: 'clean_check_lights_off', label: 'Lights Off' },
                        { key: 'clean_check_office_door_closed', label: 'Office Door Closed' },
                        { key: 'clean_check_door_locked', label: 'Front Door Locked' },
                        { key: 'clean_check_deep_cleaning_done', label: 'Deep Cleaning' },
                      ].map(({ key, label }) => (
                        <div key={key} className={`flex items-center gap-2 p-2 rounded ${(cleaningReport as any)[key] ? 'bg-green-100' : 'bg-muted'}`}>
                          <div className={`w-4 h-4 rounded-full flex-shrink-0 ${(cleaningReport as any)[key] ? 'bg-green-500' : 'bg-muted-foreground/30'}`} />
                          <span className="text-sm">{label}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Maintenance Issues */}
                  {cleaningReport.clean_issues_notes && (
                    <div className="border-t pt-4">
                      <label className="text-sm font-medium text-destructive mb-2 block">Maintenance Issues</label>
                      <p className="text-sm bg-destructive/10 p-3 rounded-lg border border-destructive/20">
                        {cleaningReport.clean_issues_notes}
                      </p>
                    </div>
                  )}
                </div>
              </CardContent>
            )}
          </Card>
        </TabsContent>

      </Tabs>

      {/* Manual Deposit Override Modal */}
      <Dialog open={showDepositModal} onOpenChange={setShowDepositModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-orange-500" />
              Manual Deposit Override
            </DialogTitle>
            <DialogDescription>
              Use <strong>ONLY</strong> if Stripe payment succeeded but webhook didn't update the booking.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="pi">Stripe Payment Intent ID (optional)</Label>
              <Input
                id="pi"
                placeholder="pi_..."
                value={manualPaymentIntentId}
                onChange={(e) => setManualPaymentIntentId(e.target.value)}
                className={!piValid ? "border-destructive" : ""}
              />
              {!piValid && (
                <p className="text-xs text-destructive">Must start with "pi_"</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="cus">Stripe Customer ID (optional)</Label>
              <Input
                id="cus"
                placeholder="cus_..."
                value={manualCustomerId}
                onChange={(e) => setManualCustomerId(e.target.value)}
                className={!cusValid ? "border-destructive" : ""}
              />
              {!cusValid && (
                <p className="text-xs text-destructive">Must start with "cus_"</p>
              )}
              <p className="text-xs text-muted-foreground">
                ⚠️ Recommended for balance auto-charge
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="cs">Stripe Session ID (optional, not saved)</Label>
              <Input
                id="cs"
                placeholder="cs_..."
                value={manualSessionId}
                onChange={(e) => setManualSessionId(e.target.value)}
                className={!csValid ? "border-destructive" : ""}
              />
              {!csValid && (
                <p className="text-xs text-destructive">Must start with "cs_"</p>
              )}
            </div>

            {(!manualPaymentIntentId || !manualCustomerId) && (
              <div className="bg-yellow-50 border border-yellow-200 rounded p-3 text-sm text-yellow-800">
                <AlertTriangle className="h-4 w-4 inline mr-1" />
                Without payment intent or customer ID, balance auto-charge may fail.
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDepositModal(false)}
              disabled={depositOverrideLoading}
            >
              Cancel
            </Button>
            <Button
              onClick={handleManualDepositOverride}
              disabled={!allValid || depositOverrideLoading}
              className="bg-orange-600 hover:bg-orange-700"
            >
              {depositOverrideLoading ? "Updating..." : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reschedule Booking Dialog */}
      <Dialog open={rescheduleOpen} onOpenChange={setRescheduleOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Reschedule Booking</DialogTitle>
            <DialogDescription>
              Change the date and time for this booking. All reminders and notifications will be updated automatically.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            {/* Read-only booking type badge */}
            <div>
              <Label className="text-sm font-medium mb-2 block">Booking Type</Label>
              <Badge 
                variant="outline" 
                className={booking.booking_type === 'daily' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-green-50 text-green-700 border-green-200'}
              >
                {booking.booking_type === 'daily' ? '📅 Full Day Rental' : '⏰ Hourly Rental'}
              </Badge>
              <p className="text-xs text-muted-foreground mt-1">
                Booking type cannot be changed
              </p>
            </div>

            {/* Current booking info */}
            <div className="bg-muted/50 p-4 rounded-lg">
              <Label className="text-sm font-medium">Current Booking</Label>
              <div className="text-sm text-muted-foreground mt-2 space-y-1">
                <div>{format(parseISO(booking.event_date + "T00:00:00"), "MM/dd/yyyy")}</div>
                {booking.booking_type === "hourly" && booking.start_time && (
                  <div>Time: {booking.start_time} - {booking.end_time}</div>
                )}
                {booking.booking_type === "daily" && booking.start_time && booking.end_time && (
                  <div className="text-xs">Event window: {booking.start_time} - {booking.end_time}</div>
                )}
              </div>
            </div>

            {/* New date picker */}
            <div>
              <Label className="text-sm font-medium mb-2 block">New Date *</Label>
              <CalendarComponent
                mode="single"
                selected={rescheduleData.date ? parseISO(rescheduleData.date + "T00:00:00") : undefined}
                onSelect={(date) =>
                  date &&
                  setRescheduleData((prev) => ({
                    ...prev,
                    date: format(date, "yyyy-MM-dd"),
                  }))
                }
                disabled={(date) => isBefore(date, new Date())}
                className="rounded-md border"
              />
            </div>

            {/* Time inputs - different for hourly vs daily */}
            {booking.booking_type === "hourly" && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="start-time" className="text-sm font-medium">
                    Start Time *
                  </Label>
                  <Input
                    id="start-time"
                    type="time"
                    value={rescheduleData.start_time}
                    onChange={(e) =>
                      setRescheduleData((prev) => ({
                        ...prev,
                        start_time: e.target.value,
                      }))
                    }
                    className="mt-1"
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="end-time" className="text-sm font-medium">
                    End Time *
                  </Label>
                  <Input
                    id="end-time"
                    type="time"
                    value={rescheduleData.end_time}
                    onChange={(e) =>
                      setRescheduleData((prev) => ({
                        ...prev,
                        end_time: e.target.value,
                      }))
                    }
                    className="mt-1"
                    required
                  />
                </div>
              </div>
            )}

            {booking.booking_type === "daily" && (
              <div className="space-y-3">
                <div>
                  <Label className="text-sm font-medium">Event Window (Optional)</Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    Daily bookings reserve the entire day. This time window is only for planning and staff notes.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="start-time-daily" className="text-sm font-medium">
                      Event Start Time
                    </Label>
                    <Input
                      id="start-time-daily"
                      type="time"
                      value={rescheduleData.start_time}
                      onChange={(e) =>
                        setRescheduleData((prev) => ({
                          ...prev,
                          start_time: e.target.value,
                        }))
                      }
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label htmlFor="end-time-daily" className="text-sm font-medium">
                      Event End Time
                    </Label>
                    <Input
                      id="end-time-daily"
                      type="time"
                      value={rescheduleData.end_time}
                      onChange={(e) =>
                        setRescheduleData((prev) => ({
                          ...prev,
                          end_time: e.target.value,
                        }))
                      }
                      className="mt-1"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Reason */}
            <div>
              <Label htmlFor="reason" className="text-sm font-medium">
                Reason for Reschedule (Optional)
              </Label>
              <Textarea
                id="reason"
                value={rescheduleData.reason}
                onChange={(e) =>
                  setRescheduleData((prev) => ({
                    ...prev,
                    reason: e.target.value,
                  }))
                }
                placeholder="e.g., Client requested date change"
                className="mt-1"
                rows={2}
              />
            </div>

            {/* Validation errors inline */}
            {rescheduleData.start_time && 
             rescheduleData.end_time && 
             rescheduleData.end_time <= rescheduleData.start_time && (
              <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/30 rounded-lg">
                <AlertTriangle className="h-4 w-4 text-destructive mt-0.5" />
                <p className="text-sm text-destructive">
                  {booking.booking_type === "daily" 
                    ? "Event end time must be after start time" 
                    : "End time must be after start time"}
                </p>
              </div>
            )}
          </div>

          <DialogFooter className="mt-6">
            <Button
              variant="outline"
              onClick={() => setRescheduleOpen(false)}
              disabled={rescheduleLoading}
            >
              Cancel
            </Button>
            <Button
              onClick={handleReschedule}
              disabled={
                rescheduleLoading ||
                !rescheduleData.date ||
                (booking.booking_type === "hourly" && (!rescheduleData.start_time || !rescheduleData.end_time)) ||
                (booking.booking_type === "hourly" && rescheduleData.start_time && rescheduleData.end_time && rescheduleData.end_time <= rescheduleData.start_time) ||
                (booking.booking_type === "daily" && rescheduleData.start_time && rescheduleData.end_time && rescheduleData.end_time <= rescheduleData.start_time)
              }
            >
              {rescheduleLoading ? "Rescheduling..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel Booking Dialog */}
      <Dialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Cancel Booking?
            </DialogTitle>
            <DialogDescription className="space-y-3 pt-2">
              <div className="font-medium text-foreground">
                This will cancel reservation <span className="font-mono bg-muted px-2 py-0.5 rounded">{booking.reservation_number}</span>
              </div>
              
              <div className="text-sm space-y-2">
                <div className="font-medium">The following actions will be performed:</div>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Mark the booking as <strong>cancelled</strong></li>
                  <li>Remove all pending and failed automated jobs</li>
                  <li>Send cancellation notification to <strong>{booking.email}</strong></li>
                  <li>Update status in GoHighLevel</li>
                </ul>
              </div>

              <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3 mt-3">
                <p className="text-sm font-medium text-destructive">
                  ⚠️ This action cannot be undone.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <Button 
              variant="outline" 
              onClick={() => setShowCancelDialog(false)}
              disabled={isCancelling}
            >
              Keep Booking
            </Button>
            <Button
              variant="destructive"
              onClick={handleCancelBooking}
              disabled={isCancelling}
            >
              {isCancelling ? "Cancelling..." : "Yes, Cancel Booking"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Production Configuration Dialog */}
      <Dialog open={showProductionDialog} onOpenChange={setShowProductionDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Configure Production</DialogTitle>
            <DialogDescription>
              Select production package and specify working hours for staff scheduling
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            {/* Package Selection */}
            <div className="space-y-2">
              <Label>Production Package</Label>
              <Select value={productionPackage} onValueChange={setProductionPackage}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No Production</SelectItem>
                  <SelectItem value="basic">Basic Package - $79/hr</SelectItem>
                  <SelectItem value="led">LED Package - $99/hr</SelectItem>
                  <SelectItem value="workshop">Workshop Package - $149/hr</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Time Inputs - Only show if package is selected */}
            {productionPackage !== "none" && (
              <div className="space-y-4 border-t pt-4">
                <div className="space-y-2">
                  <Label htmlFor="prod-start">Production Start Time</Label>
                  <Input
                    id="prod-start"
                    type="time"
                    value={productionStartTime}
                    onChange={(e) => setProductionStartTime(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="prod-end">Production End Time</Label>
                  <Input
                    id="prod-end"
                    type="time"
                    value={productionEndTime}
                    onChange={(e) => setProductionEndTime(e.target.value)}
                    required
                  />
                </div>
                {booking?.booking_type === "hourly" && booking.start_time && booking.end_time && (
                  <p className="text-xs text-muted-foreground">
                    Booking time: {booking.start_time.slice(0, 5)} - {booking.end_time.slice(0, 5)}
                  </p>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowProductionDialog(false)}
              disabled={productionLoading}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveProduction}
              disabled={productionLoading}
            >
              {productionLoading ? "Saving..." : "Save Configuration"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
