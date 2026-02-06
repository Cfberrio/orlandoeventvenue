import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, addDays } from "date-fns";
import type { Json } from "@/integrations/supabase/types";

// Helper function to sync booking to GHL
async function syncToGHL(bookingId: string) {
  try {
    const { error } = await supabase.functions.invoke("sync-to-ghl", {
      body: { booking_id: bookingId },
    });
    if (error) {
      console.error("Error syncing to GHL:", error);
    }
  } catch (err) {
    console.error("Failed to sync to GHL:", err);
  }
}
// Types
export interface Booking {
  id: string;
  reservation_number: string | null;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  booking_type: "hourly" | "daily";
  number_of_guests: number;
  event_type: string;
  event_type_other: string | null;
  client_notes: string | null;
  package: "none" | "basic" | "led" | "workshop";
  package_start_time: string | null;
  package_end_time: string | null;
  setup_breakdown: boolean;
  tablecloths: boolean;
  tablecloth_quantity: number;
  base_rental: number;
  cleaning_fee: number;
  package_cost: number;
  optional_services: number;
  taxes_fees: number;
  total_amount: number;
  deposit_amount: number;
  balance_amount: number;
  discount_amount: number | null;
  discount_code: string | null;
  payment_status: string;
  deposit_paid_at: string | null;
  balance_paid_at: string | null;
  full_name: string;
  email: string;
  phone: string;
  company: string | null;
  status: string;
  lifecycle_status: string;
  lead_source: string | null;
  pre_event_ready: string | null;
  host_report_step: string | null;
  created_at: string;
  booking_origin: "website" | "internal" | "external";
  policy_id: string;
}

export interface StaffMember {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  role: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface BookingEvent {
  id: string;
  booking_id: string;
  event_type: string;
  channel: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface CleaningReport {
  id: string;
  booking_id: string;
  cleaner_id: string | null;
  cleaner_name: string | null;
  cleaner_role: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  started_at: string | null;
  completed_at: string | null;
  status: string;
  floors_clean: boolean | null;
  restrooms_clean: boolean | null;
  trash_removed: boolean | null;
  surfaces_clean: boolean | null;
  damage_found: boolean | null;
  damage_notes: string | null;
  clean_issues_notes: string | null;
  inventory_update_needed: boolean | null;
  inventory_items: Json | null;
  media_front_door: Json | null;
  media_main_area: Json | null;
  media_rack: Json | null;
  media_bathrooms: Json | null;
  media_kitchen: Json | null;
  media_deep_cleaning: Json | null;
  clean_check_floors: boolean | null;
  clean_check_bathrooms: boolean | null;
  clean_check_kitchen: boolean | null;
  clean_check_trash_removed: boolean | null;
  clean_check_equipment_stored: boolean | null;
  clean_check_tables_chairs_positioned: boolean | null;
  clean_check_lights_off: boolean | null;
  clean_check_office_door_closed: boolean | null;
  clean_check_door_locked: boolean | null;
  clean_check_deep_cleaning_done: boolean | null;
  created_at: string;
  updated_at: string;
}

export interface HostReport {
  id: string;
  booking_id: string;
  status: string;
  notes: string | null;
  submitted_at: string;
  reviewed_at: string | null;
  reviewed_by_id: string | null;
  created_at: string;
  updated_at: string;
  guest_name: string | null;
  guest_email: string | null;
  guest_phone: string | null;
  guest_confirm_area_clean: boolean | null;
  guest_confirm_trash_bagged: boolean | null;
  guest_confirm_bathrooms_ok: boolean | null;
  guest_confirm_door_closed: boolean | null;
  has_issue: boolean | null;
  issue_description: string | null;
}

export interface BookingReview {
  id: string;
  booking_id: string;
  source: string;
  rating: number;
  comment: string | null;
  reviewer_name: string | null;
  review_url: string | null;
  created_at: string;
}

export interface MaintenanceTicket {
  id: string;
  booking_id: string | null;
  title: string;
  venue_area: string | null;
  issue_type: string | null;
  description: string | null;
  reported_by_role: string | null;
  priority: string;
  status: string;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

export interface StaffAssignment {
  id: string;
  booking_id: string;
  staff_id: string;
  assignment_role: string;
  notes: string | null;
  assignment_type?: string | null;
  cleaning_type?: string | null;
  celebration_surcharge?: number | null;
  created_at: string;
  updated_at: string;
  staff_member?: StaffMember;
  booking?: {
    package: string;
    package_start_time: string | null;
    package_end_time: string | null;
    start_time: string | null;
    end_time: string | null;
  };
}

export interface BookingAttachment {
  id: string;
  booking_id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  storage_path: string;
  category: string;
  description: string | null;
  created_at: string;
}

// Dashboard hooks
export function useTodaysBookings() {
  const today = format(new Date(), "yyyy-MM-dd");
  return useQuery({
    queryKey: ["bookings", "today", today],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select("*")
        .eq("event_date", today)
        .order("start_time", { ascending: true });
      if (error) throw error;
      return data as Booking[];
    },
  });
}

export function useUpcomingBookings(limit = 5) {
  const today = format(new Date(), "yyyy-MM-dd");
  return useQuery({
    queryKey: ["bookings", "upcoming", limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select("*")
        .gte("event_date", today)
        .order("event_date", { ascending: true })
        .order("start_time", { ascending: true })
        .limit(limit);
      if (error) throw error;
      return data as Booking[];
    },
  });
}

export function useWeeklyRevenue() {
  const start = format(startOfWeek(new Date()), "yyyy-MM-dd");
  const end = format(endOfWeek(new Date()), "yyyy-MM-dd");
  return useQuery({
    queryKey: ["bookings", "weekly-revenue", start, end],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select("total_amount")
        .gte("event_date", start)
        .lte("event_date", end);
      if (error) throw error;
      const total = data.reduce((sum, b) => sum + Number(b.total_amount || 0), 0);
      return { total, count: data.length };
    },
  });
}

export function usePipelineSummary() {
  return useQuery({
    queryKey: ["bookings", "pipeline"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select("lifecycle_status");
      if (error) throw error;
      const counts: Record<string, number> = {};
      data.forEach((b) => {
        const status = b.lifecycle_status || "pending";
        counts[status] = (counts[status] || 0) + 1;
      });
      return counts;
    },
  });
}

export function useOperationalAlerts() {
  const today = new Date();
  const threeDaysLater = format(addDays(today, 3), "yyyy-MM-dd");
  const todayStr = format(today, "yyyy-MM-dd");
  
  return useQuery({
    queryKey: ["bookings", "alerts", todayStr, threeDaysLater],
    queryFn: async () => {
      const { data: bookings, error: bookingsError } = await supabase
        .from("bookings")
        .select("*")
        .gte("event_date", todayStr)
        .lte("event_date", threeDaysLater)
        .neq("pre_event_ready", "true");
      if (bookingsError) throw bookingsError;
      return bookings as Booking[];
    },
  });
}

export interface IssueAlert {
  id: string;
  booking_id: string;
  type: 'cleaning' | 'guest';
  issue_text: string;
  reported_by: string | null;
  created_at: string;
  booking?: {
    reservation_number: string | null;
    full_name: string;
    event_date: string;
    lifecycle_status: string;
  };
}

export function useIssueAlerts() {
  return useQuery({
    queryKey: ["issue-alerts"],
    queryFn: async () => {
      const alerts: IssueAlert[] = [];

      // Get cleaning reports with issues (not closed)
      const { data: cleaningReports, error: cleaningError } = await supabase
        .from("booking_cleaning_reports")
        .select("id, booking_id, clean_issues_notes, cleaner_name, created_at, bookings(reservation_number, full_name, event_date, lifecycle_status)")
        .not("clean_issues_notes", "is", null)
        .neq("clean_issues_notes", "");
      
      if (cleaningError) throw cleaningError;

      cleaningReports?.forEach((report: {
        id: string;
        booking_id: string;
        clean_issues_notes: string | null;
        cleaner_name: string | null;
        created_at: string;
        bookings: {
          reservation_number: string | null;
          full_name: string;
          event_date: string;
          lifecycle_status: string;
        } | null;
      }) => {
        if (report.bookings && report.bookings.lifecycle_status !== 'closed_review_complete') {
          alerts.push({
            id: report.id,
            booking_id: report.booking_id,
            type: 'cleaning',
            issue_text: report.clean_issues_notes || '',
            reported_by: report.cleaner_name,
            created_at: report.created_at,
            booking: report.bookings,
          });
        }
      });

      // Get host reports with issues (not closed)
      const { data: hostReports, error: hostError } = await supabase
        .from("booking_host_reports")
        .select("id, booking_id, issue_description, guest_name, created_at, bookings(reservation_number, full_name, event_date, lifecycle_status)")
        .eq("has_issue", true)
        .not("issue_description", "is", null)
        .neq("issue_description", "");
      
      if (hostError) throw hostError;

      hostReports?.forEach((report: {
        id: string;
        booking_id: string;
        issue_description: string | null;
        guest_name: string | null;
        created_at: string;
        bookings: {
          reservation_number: string | null;
          full_name: string;
          event_date: string;
          lifecycle_status: string;
        } | null;
      }) => {
        if (report.bookings && report.bookings.lifecycle_status !== 'closed_review_complete') {
          alerts.push({
            id: report.id,
            booking_id: report.booking_id,
            type: 'guest',
            issue_text: report.issue_description || '',
            reported_by: report.guest_name,
            created_at: report.created_at,
            booking: report.bookings,
          });
        }
      });

      // Sort by created_at descending
      alerts.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      return alerts;
    },
  });
}

export interface StaffUnassignmentAlert {
  id: string;
  booking_id: string;
  staff_name: string;
  staff_role: string;
  unassigned_at: string;
  created_at: string;
  booking?: {
    reservation_number: string | null;
    full_name: string;
    event_date: string;
    lifecycle_status: string;
  };
}

export function useStaffUnassignmentAlerts() {
  return useQuery({
    queryKey: ["staff-unassignment-alerts"],
    queryFn: async () => {
      const { data: events, error } = await supabase
        .from("booking_events")
        .select("id, booking_id, metadata, created_at, bookings(reservation_number, full_name, event_date, lifecycle_status)")
        .eq("event_type", "staff_unassigned")
        .order("created_at", { ascending: false });
      
      if (error) throw error;

      const alerts: StaffUnassignmentAlert[] = [];

      events?.forEach((event: {
        id: string;
        booking_id: string;
        metadata: any;
        created_at: string;
        bookings: {
          reservation_number: string | null;
          full_name: string;
          event_date: string;
          lifecycle_status: string;
        } | null;
      }) => {
        if (event.bookings && event.bookings.lifecycle_status !== 'closed_review_complete' && event.bookings.lifecycle_status !== 'cancelled') {
          const metadata = event.metadata || {};
          // Skip if alert is resolved
          if (metadata.resolved) return;
          
          alerts.push({
            id: event.id,
            booking_id: event.booking_id,
            staff_name: metadata.staff_name || 'Unknown Staff',
            staff_role: metadata.staff_role || 'Unknown Role',
            unassigned_at: metadata.unassigned_at || event.created_at,
            created_at: event.created_at,
            booking: event.bookings,
          });
        }
      });

      return alerts;
    },
  });
}

export function useResolveStaffUnassignmentAlert() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (alertId: string) => {
      // Get the current event
      const { data: event, error: fetchError } = await supabase
        .from("booking_events")
        .select("metadata")
        .eq("id", alertId)
        .single();
      
      if (fetchError) throw fetchError;
      
      // Update the metadata to mark as resolved
      const existingMetadata = typeof event.metadata === 'object' && event.metadata !== null
        ? event.metadata as Record<string, unknown>
        : {};
      const updatedMetadata = {
        ...existingMetadata,
        resolved: true,
        resolved_at: new Date().toISOString(),
      };
      
      const { error: updateError } = await supabase
        .from("booking_events")
        .update({ metadata: updatedMetadata })
        .eq("id", alertId);
      
      if (updateError) throw updateError;
      
      return { success: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff-unassignment-alerts"] });
    },
  });
}

// Bookings hooks
export function useBookings(filters?: {
  dateFrom?: string;
  dateTo?: string;
  lifecycleStatus?: string[];
  paymentStatus?: string;
  eventType?: string;
}) {
  return useQuery({
    queryKey: ["bookings", filters],
    queryFn: async () => {
      let query = supabase.from("bookings").select("*").order("event_date", { ascending: false });
      
      if (filters?.dateFrom) {
        query = query.gte("event_date", filters.dateFrom);
      }
      if (filters?.dateTo) {
        query = query.lte("event_date", filters.dateTo);
      }
      if (filters?.lifecycleStatus?.length) {
        query = query.in("lifecycle_status", filters.lifecycleStatus);
      }
      if (filters?.paymentStatus) {
        query = query.eq("payment_status", filters.paymentStatus as "pending" | "deposit_paid" | "fully_paid" | "failed" | "refunded" | "invoiced");
      }
      if (filters?.eventType) {
        query = query.eq("event_type", filters.eventType);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      return data as Booking[];
    },
  });
}

export function useBooking(id: string) {
  return useQuery({
    queryKey: ["booking", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select("*")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data as Booking;
    },
    enabled: !!id,
  });
}

export function useBookingEvents(bookingId: string) {
  return useQuery({
    queryKey: ["booking-events", bookingId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("booking_events")
        .select("*")
        .eq("booking_id", bookingId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as BookingEvent[];
    },
    enabled: !!bookingId,
  });
}

export function useBookingStaffAssignments(bookingId: string) {
  return useQuery({
    queryKey: ["booking-staff-assignments", bookingId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("booking_staff_assignments")
        .select(`
          *,
          staff_members(*),
          bookings(package, package_start_time, package_end_time, start_time, end_time, booking_type)
        `)
        .eq("booking_id", bookingId);
      if (error) throw error;
      return data.map((d: any) => ({
        ...d,
        staff_member: d.staff_members,
        booking: d.bookings,
      })) as StaffAssignment[];
    },
    enabled: !!bookingId,
  });
}

export function useBookingCleaningReports(bookingId: string) {
  return useQuery({
    queryKey: ["booking-cleaning-reports", bookingId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("booking_cleaning_reports")
        .select("*")
        .eq("booking_id", bookingId);
      if (error) throw error;
      return data as CleaningReport[];
    },
    enabled: !!bookingId,
  });
}

export function useBookingHostReports(bookingId: string) {
  return useQuery({
    queryKey: ["booking-host-reports", bookingId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("booking_host_reports")
        .select("*")
        .eq("booking_id", bookingId);
      if (error) throw error;
      return data as HostReport[];
    },
    enabled: !!bookingId,
  });
}

export function useBookingReviews(bookingId: string) {
  return useQuery({
    queryKey: ["booking-reviews", bookingId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("booking_reviews")
        .select("*")
        .eq("booking_id", bookingId);
      if (error) throw error;
      return data as BookingReview[];
    },
    enabled: !!bookingId,
  });
}

export function useBookingMaintenanceTickets(bookingId: string) {
  return useQuery({
    queryKey: ["booking-maintenance-tickets", bookingId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("maintenance_tickets")
        .select("*")
        .eq("booking_id", bookingId);
      if (error) throw error;
      return data as MaintenanceTicket[];
    },
    enabled: !!bookingId,
  });
}

export function useBookingAttachments(bookingId: string) {
  return useQuery({
    queryKey: ["booking-attachments", bookingId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("booking_attachments")
        .select("*")
        .eq("booking_id", bookingId);
      if (error) throw error;
      return data as BookingAttachment[];
    },
    enabled: !!bookingId,
  });
}

// Staff hooks
export function useStaffMembers(filters?: { role?: string; isActive?: boolean }) {
  return useQuery({
    queryKey: ["staff-members", filters],
    queryFn: async () => {
      let query = supabase.from("staff_members").select("*").order("full_name");
      if (filters?.role) {
        query = query.eq("role", filters.role);
      }
      if (filters?.isActive !== undefined) {
        query = query.eq("is_active", filters.isActive);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data as StaffMember[];
    },
  });
}

// Cleaning hooks
export function useCleaningReports(filters?: {
  dateFrom?: string;
  dateTo?: string;
  status?: string;
  cleanerId?: string;
}) {
  return useQuery({
    queryKey: ["cleaning-reports", filters],
    queryFn: async () => {
      const { data: reports, error: reportsError } = await supabase
        .from("booking_cleaning_reports")
        .select("*, bookings(*)")
        .order("created_at", { ascending: false });
      if (reportsError) throw reportsError;
      
      let filtered = reports;
      if (filters?.status) {
        filtered = filtered.filter((r) => r.status === filters.status);
      }
      if (filters?.cleanerId) {
        filtered = filtered.filter((r) => r.cleaner_id === filters.cleanerId);
      }
      if (filters?.dateFrom) {
        filtered = filtered.filter((r) => (r.bookings as Booking)?.event_date >= filters.dateFrom!);
      }
      if (filters?.dateTo) {
        filtered = filtered.filter((r) => (r.bookings as Booking)?.event_date <= filters.dateTo!);
      }
      
      return filtered as (CleaningReport & { bookings: Booking })[];
    },
  });
}

// Reports hooks
export function useReportsData(filters: {
  dateFrom: string;
  dateTo: string;
  eventType?: string;
  leadSource?: string;
  lifecycleStatus?: string[];
}) {
  return useQuery({
    queryKey: ["reports", filters],
    queryFn: async () => {
      let query = supabase
        .from("bookings")
        .select("*")
        .gte("event_date", filters.dateFrom)
        .lte("event_date", filters.dateTo);
      
      if (filters.eventType) {
        query = query.eq("event_type", filters.eventType);
      }
      if (filters.leadSource) {
        query = query.eq("lead_source", filters.leadSource);
      }
      if (filters.lifecycleStatus?.length) {
        query = query.in("lifecycle_status", filters.lifecycleStatus);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      return data as Booking[];
    },
  });
}

// Mutations
export function useUpdateBooking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Record<string, unknown> }) => {
      const { data, error } = await supabase
        .from("bookings")
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["booking", id] });
      queryClient.invalidateQueries({ queryKey: ["bookings"] });
    },
  });
}

export function useCreateBookingEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (event: { booking_id: string; event_type: string; channel?: string | null; metadata?: Json }) => {
      const { data, error } = await supabase
        .from("booking_events")
        .insert([{
          booking_id: event.booking_id,
          event_type: event.event_type,
          channel: event.channel,
          metadata: event.metadata,
        }])
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["booking-events", variables.booking_id] });
    },
  });
}

export function useCreateStaffAssignment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (assignment: { 
      booking_id: string; 
      staff_id: string; 
      assignment_role: string; 
      notes?: string;
      assignment_type?: string;
      cleaning_type?: string;
      celebration_surcharge?: number;
    }) => {
      // Validate that staff member has an email before creating assignment
      const { data: staffMember, error: staffError } = await supabase
        .from("staff_members")
        .select("email, full_name")
        .eq("id", assignment.staff_id)
        .single();
      
      if (staffError) throw staffError;
      
      if (!staffMember.email || staffMember.email.trim() === "") {
        throw new Error("This staff member doesn't have an email address. Please add one before assigning.");
      }

      const { data, error } = await supabase
        .from("booking_staff_assignments")
        .insert(assignment)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: async (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["booking-staff-assignments", variables.booking_id] });
      
      // Sync to GHL after staff assignment created
      syncToGHL(variables.booking_id);

      // Send staff assignment notification email
      try {
        // Fetch booking details with policy
        const { data: booking, error: bookingError } = await supabase
          .from("bookings")
          .select("reservation_number, event_date, start_time, end_time, package, package_start_time, package_end_time, full_name, booking_origin, booking_policies(*)")
          .eq("id", variables.booking_id)
          .single();

        if (bookingError) {
          console.error("Error fetching booking for email:", bookingError);
          return;
        }

        // [POLICY GUARD] Check if staff assignment emails are enabled for this booking
        if (booking.booking_policies && booking.booking_policies.send_staff_assignment_emails === false) {
          console.log(
            `[POLICY_SKIP] Staff assignment email skipped ` +
            `(booking: ${variables.booking_id}, origin: ${booking.booking_origin}, ` +
            `policy: ${booking.booking_policies.policy_name})`
          );
          return; // Skip email but don't fail the assignment
        }

        // Fetch staff member details
        const { data: staffMember, error: staffError } = await supabase
          .from("staff_members")
          .select("full_name, email")
          .eq("id", variables.staff_id)
          .single();

        if (staffError) {
          console.error("Error fetching staff member for email:", staffError);
          return;
        }

        if (!staffMember.email) {
          console.error("Staff member has no email address");
          return;
        }

        // Format the date
        const eventDate = new Date(booking.event_date + 'T00:00:00');
        const eventDateLong = eventDate.toLocaleDateString("en-US", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        });

        // Determine time range based on role
        let eventTimeRange = "TBD";
        if (variables.assignment_role === "Production" && booking.package_start_time && booking.package_end_time) {
          // Production staff uses package times
          eventTimeRange = formatTimeRange(booking.package_start_time, booking.package_end_time);
        } else if (booking.start_time && booking.end_time) {
          // Other roles use booking times
          eventTimeRange = formatTimeRange(booking.start_time, booking.end_time);
        }

        // Call the Edge Function to send email
        const { error: emailError } = await supabase.functions.invoke("send-staff-assignment", {
          body: {
            staffEmail: staffMember.email,
            staffName: staffMember.full_name,
            reservationNumber: booking.reservation_number || "N/A",
            eventDateLong,
            eventTimeRange,
            staffRole: variables.assignment_role,
            adminNotes: variables.notes || "No special notes",
            logoUrl: "https://orlandoeventvenue.org/logo.png",
          },
        });

        if (emailError) {
          console.error("Error sending staff assignment email:", emailError);
        } else {
          console.log("Staff assignment email sent successfully");
        }
      } catch (emailError) {
        console.error("Failed to send staff assignment email:", emailError);
        // Don't fail the assignment because of email issues
      }
    },
  });
}

// Helper function to format time for emails
function formatTimeRange(startTime: string | null, endTime: string | null): string {
  if (!startTime || !endTime) return "TBD";
  
  const formatTime = (timeString: string): string => {
    const [hours, minutes] = timeString.split(":");
    const hour = parseInt(hours, 10);
    const ampm = hour >= 12 ? "PM" : "AM";
    const hour12 = hour % 12 || 12;
    return `${hour12}:${minutes} ${ampm}`;
  };
  
  return `${formatTime(startTime)} - ${formatTime(endTime)}`;
}

export function useDeleteStaffAssignment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, bookingId }: { id: string; bookingId: string }) => {
      const { error } = await supabase.from("booking_staff_assignments").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, { bookingId }) => {
      queryClient.invalidateQueries({ queryKey: ["booking-staff-assignments", bookingId] });
      // Sync to GHL after staff assignment deleted
      syncToGHL(bookingId);
    },
  });
}

export function useCreateCleaningReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (report: { booking_id: string; status?: string }) => {
      const { data, error } = await supabase
        .from("booking_cleaning_reports")
        .insert({ booking_id: report.booking_id, status: report.status || "pending" })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["booking-cleaning-reports", variables.booking_id] });
      queryClient.invalidateQueries({ queryKey: ["cleaning-reports"] });
      // Sync to GHL after cleaning report created
      syncToGHL(variables.booking_id);
    },
  });
}

export function useUpdateCleaningReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, bookingId, updates }: { id: string; bookingId: string; updates: Partial<CleaningReport> }) => {
      const { data, error } = await supabase
        .from("booking_cleaning_reports")
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["booking-cleaning-reports"] });
      queryClient.invalidateQueries({ queryKey: ["cleaning-reports"] });
      // Sync to GHL after cleaning report updated (especially when completed)
      syncToGHL(variables.bookingId);
    },
  });
}

export function useUpdateHostReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, bookingId, updates }: { id: string; bookingId: string; updates: Partial<HostReport> }) => {
      const { data, error } = await supabase
        .from("booking_host_reports")
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["booking-host-reports"] });
      // Sync to GHL after host report updated/submitted
      syncToGHL(variables.bookingId);
    },
  });
}

export function useCreateBookingReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (review: { booking_id: string; source: string; rating: number; comment?: string; reviewer_name?: string; review_url?: string }) => {
      const { data, error } = await supabase
        .from("booking_reviews")
        .insert(review)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["booking-reviews", variables.booking_id] });
      // Sync to GHL after review created
      syncToGHL(variables.booking_id);
    },
  });
}

export function useCreateStaffMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (staff: Omit<StaffMember, "id" | "created_at" | "updated_at">) => {
      const { data, error } = await supabase.from("staff_members").insert(staff).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff-members"] });
    },
  });
}

export function useUpdateStaffMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<StaffMember> }) => {
      const { data, error } = await supabase.from("staff_members").update(updates).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff-members"] });
    },
  });
}

export function useCreateMaintenanceTicket() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ticket: Omit<MaintenanceTicket, "id" | "created_at" | "updated_at" | "resolved_at">) => {
      const { data, error } = await supabase.from("maintenance_tickets").insert(ticket).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["booking-maintenance-tickets"] });
    },
  });
}

export function useUpdateMaintenanceTicket() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<MaintenanceTicket> }) => {
      const { data, error } = await supabase.from("maintenance_tickets").update(updates).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["booking-maintenance-tickets"] });
    },
  });
}

// Schedule hooks
export function useScheduleData(dateFrom: string, dateTo: string) {
  return useQuery({
    queryKey: ["schedule", dateFrom, dateTo],
    queryFn: async () => {
      const [bookingsRes, cleaningRes] = await Promise.all([
        supabase
          .from("bookings")
          .select("*")
          .gte("event_date", dateFrom)
          .lte("event_date", dateTo)
          .order("event_date"),
        supabase
          .from("booking_cleaning_reports")
          .select("*, bookings(*)")
          .not("scheduled_start", "is", null),
      ]);
      
      if (bookingsRes.error) throw bookingsRes.error;
      if (cleaningRes.error) throw cleaningRes.error;
      
      return {
        bookings: bookingsRes.data as Booking[],
        cleaningReports: cleaningRes.data as (CleaningReport & { bookings: Booking })[],
      };
    },
  });
}

// Reminders hooks
export function useUpcomingBookingsForReminders(days = 7) {
  const today = format(new Date(), "yyyy-MM-dd");
  const futureDate = format(addDays(new Date(), days), "yyyy-MM-dd");
  
  return useQuery({
    queryKey: ["bookings-reminders", today, futureDate],
    queryFn: async () => {
      const { data: bookings, error: bookingsError } = await supabase
        .from("bookings")
        .select("*")
        .gte("event_date", today)
        .lte("event_date", futureDate)
        .order("event_date");
      if (bookingsError) throw bookingsError;
      
      const bookingIds = bookings.map((b) => b.id);
      const { data: events, error: eventsError } = await supabase
        .from("booking_events")
        .select("*")
        .in("booking_id", bookingIds);
      if (eventsError) throw eventsError;
      
      return {
        bookings: bookings as Booking[],
        events: events as BookingEvent[],
      };
    },
  });
}

export function usePastBookingsForReviews(days = 30) {
  const today = format(new Date(), "yyyy-MM-dd");
  const pastDate = format(addDays(new Date(), -days), "yyyy-MM-dd");
  
  return useQuery({
    queryKey: ["bookings-reviews", pastDate, today],
    queryFn: async () => {
      const { data: bookings, error: bookingsError } = await supabase
        .from("bookings")
        .select("*")
        .gte("event_date", pastDate)
        .lt("event_date", today)
        .order("event_date", { ascending: false });
      if (bookingsError) throw bookingsError;
      
      const bookingIds = bookings.map((b) => b.id);
      
      const [eventsRes, reviewsRes] = await Promise.all([
        supabase.from("booking_events").select("*").in("booking_id", bookingIds),
        supabase.from("booking_reviews").select("*").in("booking_id", bookingIds),
      ]);
      
      if (eventsRes.error) throw eventsRes.error;
      if (reviewsRes.error) throw reviewsRes.error;
      
      return {
        bookings: bookings as Booking[],
        events: eventsRes.data as BookingEvent[],
        reviews: reviewsRes.data as BookingReview[],
      };
    },
  });
}

// Type for discount coupons (until types regenerate)
export type DiscountCoupon = {
  id: string;
  code: string;
  discount_type: 'percentage' | 'fixed_amount';
  discount_value: number;
  applies_to: string;
  applies_to_hourly: boolean;
  applies_to_daily: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

// Discount Coupons hooks
export function useDiscountCoupons(activeOnly?: boolean) {
  return useQuery({
    queryKey: ["discount-coupons", activeOnly],
    queryFn: async () => {
      let query = supabase
        .from("discount_coupons")
        .select("*")
        .order("created_at", { ascending: false });
      
      if (activeOnly) {
        query = query.eq("is_active", true);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateDiscountCoupon() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (coupon: {
      code: string;
      discount_type: "percentage" | "fixed_amount";
      discount_value: number;
      applies_to_hourly: boolean;
      applies_to_daily: boolean;
      is_active: boolean;
    }) => {
      const { data, error } = await supabase
        .from("discount_coupons")
        .insert({
          ...coupon,
          code: coupon.code.toUpperCase(), // Always uppercase
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["discount-coupons"] });
    },
  });
}

export function useUpdateDiscountCoupon() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string;
      updates: Partial<{
        code: string;
        discount_type: "percentage" | "fixed_amount";
        discount_value: number;
        applies_to_hourly: boolean;
        applies_to_daily: boolean;
        is_active: boolean;
      }>;
    }) => {
      if (updates.code) {
        updates.code = updates.code.toUpperCase();
      }
      const { data, error } = await supabase
        .from("discount_coupons")
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["discount-coupons"] });
    },
  });
}

export function useDeleteDiscountCoupon() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("discount_coupons")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["discount-coupons"] });
    },
  });
}
