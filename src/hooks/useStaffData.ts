import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useStaffSession } from "./useStaffSession";
import { isScheduledWork } from "@/lib/staffPortal";

export interface StaffBooking {
  id: string;
  reservation_number: string | null;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  booking_type: string;
  event_type: string;
  number_of_guests: number;
  full_name: string;
  package: string;
  package_start_time: string | null;
  package_end_time: string | null;
  client_notes: string | null;
  lifecycle_status: string;
  assignment_role: string;
  assignment_id: string;
  scheduled_start_time: string | null;
  scheduled_end_time: string | null;
  // Bar service fields (only meaningful for Bar Vendor assignments)
  bar_package: string | null;
  bar_package_label: string | null;
  bar_guest_count: number | null;
  bar_customer_contacted: boolean | null;
  bar_client_phone_released: boolean | null;
  customer_contact_due_at: string | null;
  customer_contacted: boolean | null;
  response_status: string | null;
  response_due_at: string | null;
  assignment_type: string | null;
}

export interface CleaningReport {
  id: string;
  booking_id: string;
  status: string;
  cleaner_name: string | null;
  cleaner_role: string | null;
  clean_issues_notes: string | null;
  inventory_update_needed: boolean;
  inventory_items: any[];
  media_front_door: any[];
  media_main_area: any[];
  media_rack: any[];
  media_bathrooms: any[];
  media_kitchen: any[];
  media_deep_cleaning: any[];
  clean_check_floors: boolean;
  clean_check_bathrooms: boolean;
  clean_check_kitchen: boolean;
  clean_check_trash_removed: boolean;
  clean_check_equipment_stored: boolean;
  clean_check_tables_chairs_positioned: boolean;
  clean_check_lights_off: boolean;
  clean_check_office_door_closed: boolean;
  clean_check_door_locked: boolean;
  clean_check_deep_cleaning_done: boolean;
  completed_at: string | null;
  created_at: string;
}

// Get bookings assigned to current staff member (using staff session)
export function useStaffAssignedBookings() {
  const { staffMember } = useStaffSession();
  
  return useQuery({
    queryKey: ["staff-assigned-bookings", staffMember?.id],
    queryFn: async () => {
      if (!staffMember?.id) return [];
      
      const { data, error } = await supabase
        .from("booking_staff_assignments")
        .select(`
          id,
          assignment_role,
          assignment_type,
          status,
          booking_id,
          customer_contact_due_at,
          customer_contacted,
          response_status,
          response_due_at,
          scheduled_start_time,
          scheduled_end_time,
          bookings!booking_staff_assignments_booking_id_fkey (
            id,
            reservation_number,
            event_date,
            start_time,
            end_time,
            booking_type,
            event_type,
            number_of_guests,
            full_name,
            package,
            package_start_time,
            package_end_time,
            client_notes,
            lifecycle_status,
            bar_package,
            bar_package_label,
            bar_guest_count,
            bar_customer_contacted,
            bar_client_phone_released
          )
        `)
        .eq("staff_id", staffMember.id)
        // ST2-12: a cancelled row (e.g. the 11/19 backfill duplicate) is not work.
        .neq("status", "cancelled")
        .order("created_at", { ascending: false });
      
      if (error) throw error;
      
      // Transform the data to include assignment role and assignment_id with booking
      // Filter out standalone assignments (no booking linked)
      return (data || [])
        .filter((assignment: any) => assignment.bookings != null)
        .map((assignment: any) => ({
          ...assignment.bookings,
          assignment_role: assignment.assignment_role,
          assignment_id: assignment.id,
          assignment_type: assignment.assignment_type ?? null,
          customer_contact_due_at: assignment.customer_contact_due_at,
          customer_contacted: assignment.customer_contacted,
          response_status: assignment.response_status ?? null,
          response_due_at: assignment.response_due_at ?? null,
          scheduled_start_time: assignment.scheduled_start_time ?? null,
          scheduled_end_time: assignment.scheduled_end_time ?? null,
        })) as StaffBooking[];
    },
    enabled: !!staffMember?.id,
  });
}

// Get single booking detail for staff (with assignment role)
export function useStaffBookingDetail(bookingId: string) {
  const { staffMember } = useStaffSession();
  
  return useQuery({
    queryKey: ["staff-booking-detail", bookingId, staffMember?.id],
    queryFn: async () => {
      if (!staffMember?.id) return null;
      
      // Get booking data
      const { data: bookingData, error: bookingError } = await supabase
        .from("bookings")
        .select("*")
        .eq("id", bookingId)
        .maybeSingle();
      
      if (bookingError) throw bookingError;
      if (!bookingData) return null;
      
      // Get assignment row for this staff member (incl. bar customer-contact fields)
      const { data: assignmentData, error: assignmentError } = await supabase
        .from("booking_staff_assignments")
        .select("id, assignment_role, assignment_type, tasks, customer_contact_due_at, customer_contacted, customer_contacted_at, status, response_status, response_due_at, scheduled_start_time, scheduled_end_time")
        .eq("booking_id", bookingId)
        .eq("staff_id", staffMember.id)
        // ST2-12: ignore cancelled rows; never error when a duplicate exists.
        .neq("status", "cancelled")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (assignmentError) throw assignmentError;

      return {
        ...bookingData,
        assignment_role: assignmentData?.assignment_role || null,
        assignment_id: assignmentData?.id || null,
        assignment_type: assignmentData?.assignment_type || null,
        assignment_status: assignmentData?.status || null,
        assignment_customer_contacted: assignmentData?.customer_contacted ?? false,
        assignment_customer_contacted_at: assignmentData?.customer_contacted_at ?? null,
        assignment_customer_contact_due_at: assignmentData?.customer_contact_due_at ?? null,
        assignment_response_status: assignmentData?.response_status ?? null,
        assignment_response_due_at: assignmentData?.response_due_at ?? null,
        assignment_tasks: (assignmentData?.tasks as Array<{ id: string; name: string; completed: boolean }>) || [],
        scheduled_start_time: assignmentData?.scheduled_start_time ?? null,
        scheduled_end_time: assignmentData?.scheduled_end_time ?? null,
      };
    },
    enabled: !!bookingId && !!staffMember?.id,
  });
}

// Get cleaning report for a booking
export function useBookingCleaningReport(bookingId: string) {
  return useQuery({
    queryKey: ["booking-cleaning-report", bookingId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("booking_cleaning_reports")
        .select("*")
        .eq("booking_id", bookingId)
        .maybeSingle();
      
      if (error) throw error;
      return data as CleaningReport | null;
    },
    enabled: !!bookingId,
  });
}

// Update or create cleaning report
export function useUpdateCleaningReport() {
  const queryClient = useQueryClient();
  const { staffMember } = useStaffSession();

  return useMutation({
    mutationFn: async ({
      bookingId,
      reportData,
    }: {
      bookingId: string;
      reportData: Partial<CleaningReport>;
    }) => {
      if (!staffMember?.id) throw new Error("Your staff session expired; sign in again");
      // E-10/E-11 (86e40ach2): one server call saves the report, opens the
      // maintenance ticket and updates inventory, or fails with the reason.
      const { data, error } = await supabase.rpc("staff_submit_cleaning_report" as any, {
        p_staff_id: staffMember.id,
        p_booking_id: bookingId,
        p_report: reportData,
      });
      if (error) throw error;
      return data as { report_id: string; ticket_id: string | null; inventory_lines: number };
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["booking-cleaning-report", variables.bookingId] });
      queryClient.invalidateQueries({ queryKey: ["staff-booking-detail"] });
    },
  });
}

// Upload file to storage
export async function uploadCleaningMedia(
  file: File,
  bookingId: string,
  fieldId: string
): Promise<string> {
  const fileExt = file.name.split('.').pop();
  const fileName = `${bookingId}/${fieldId}/${Date.now()}.${fileExt}`;
  
  const { error: uploadError } = await supabase.storage
    .from("cleaning-media")
    .upload(fileName, file);
  
  if (uploadError) throw uploadError;
  
  const { data } = supabase.storage
    .from("cleaning-media")
    .getPublicUrl(fileName);
  
  return data.publicUrl;
}

// Create maintenance ticket
export function useCreateMaintenanceTicket() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (ticket: {
      booking_id: string;
      title: string;
      description: string;
      reported_by_role: string;
      priority: string;
    }) => {
      const { data, error } = await supabase
        .from("maintenance_tickets")
        .insert(ticket)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["maintenance-tickets"] });
    },
  });
}

// Remove staff assignment (self-unassign)
export function useRemoveStaffAssignment() {
  const queryClient = useQueryClient();
  const { staffMember } = useStaffSession();
  
  return useMutation({
    mutationFn: async ({ assignmentId }: { bookingId: string; assignmentId: string }) => {
      if (!staffMember?.id) throw new Error("Not signed in");
      // M-33 (86e40ach2): the old browser-side delete was silently blocked by
      // table permissions (anon has no DELETE), so staff thought they were off
      // the event and the office never knew. The RPC removes the assignment,
      // refuses once the work is completed or paid, and records the event.
      const { error } = await supabase.rpc("staff_unassign_self" as any, {
        p_assignment_id: assignmentId,
        p_staff_id: staffMember.id,
      });
      if (error) throw error;
      return { success: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff-assigned-bookings"] });
      queryClient.invalidateQueries({ queryKey: ["staff-booking-detail"] });
    },
  });
}

// Get schedule data for staff (bookings assigned to them in a date range)
export function useStaffScheduleData(dateFrom: string, dateTo: string) {
  const { staffMember } = useStaffSession();
  
  return useQuery({
    queryKey: ["staff-schedule-data", staffMember?.id, dateFrom, dateTo],
    queryFn: async () => {
      if (!staffMember?.id) return { bookings: [] };
      
      // First, get all bookings in the date range
      const { data: bookingsData, error: bookingsError } = await supabase
        .from("bookings")
        .select("id, reservation_number, event_date, start_time, end_time, booking_type, event_type, number_of_guests, full_name, lifecycle_status")
        .gte("event_date", dateFrom)
        .lte("event_date", dateTo);
      
      if (bookingsError) throw bookingsError;
      
      // Get all assignments for this staff member
      const { data: assignmentsData, error: assignmentsError } = await supabase
        .from("booking_staff_assignments")
        .select("booking_id, assignment_role, status, response_status")
        .eq("staff_id", staffMember.id)
        .not("booking_id", "is", null);
      
      if (assignmentsError) throw assignmentsError;
      
      // ST2-13: only work the staff member still has (not cancelled, not declined).
      
      // Create a map of booking_id -> assignment_role
      const assignmentMap = new Map(
        (assignmentsData || []).filter(isScheduledWork).map(a => [a.booking_id, a.assignment_role])
      );
      
      // Filter bookings to only include those assigned to this staff member
      const bookings = (bookingsData || [])
        .filter(booking => assignmentMap.has(booking.id) && booking.lifecycle_status !== "cancelled")
        .map(booking => ({
          ...booking,
          assignment_role: assignmentMap.get(booking.id),
        }));
      
      return { bookings };
    },
    enabled: !!staffMember?.id && !!dateFrom && !!dateTo,
  });
}

// Bar Vendor: Mark customer as contacted from staff portal.
// One RPC updates the assignment, the booking's bar fields and the audit
// event. Contacting the guest no longer completes the assignment: completion
// (and payroll) follows the event like every other role (ClickUp 86e40ach2,
// S-2 / M-34).
export function useMarkBarCustomerContacted() {
  const queryClient = useQueryClient();
  const { staffMember } = useStaffSession();

  return useMutation({
    mutationFn: async ({ bookingId: _bookingId, assignmentId }: { bookingId: string; assignmentId: string }) => {
      if (!staffMember?.id) throw new Error("Staff session expired. Please log in again.");

      const { error } = await (supabase.rpc as any)("staff_mark_bar_contacted", {
        p_assignment_id: assignmentId,
        p_staff_id: staffMember.id,
      });
      if (error) throw error;

      return { success: true };
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["staff-booking-detail", vars.bookingId] });
      queryClient.invalidateQueries({ queryKey: ["staff-assigned-bookings"] });
      queryClient.invalidateQueries({ queryKey: ["booking", vars.bookingId] });
    },
  });
}

// Staff accepts or rejects a booking assignment from the staff portal.
// ST2-16: the RPC records the answer and the database queues the office email
// (send-staff-notices). The browser no longer calls a public mail function.
export function useRespondToAssignment() {
  const queryClient = useQueryClient();
  const { staffMember } = useStaffSession();

  return useMutation({
    mutationFn: async ({
      assignmentId,
      response,
    }: {
      bookingId: string;
      assignmentId: string;
      response: "accepted" | "rejected";
    }) => {
      if (!staffMember?.id) throw new Error("Staff session expired. Please log in again.");

      const { data, error } = await (supabase.rpc as any)("staff_respond_to_assignment", {
        p_assignment_id: assignmentId,
        p_staff_id: staffMember.id,
        p_response: response,
      });
      if (error) throw error;

      return { success: true, changed: (data as { changed?: boolean } | null)?.changed !== false };
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["staff-assigned-bookings"] });
      queryClient.invalidateQueries({ queryKey: ["staff-booking-detail", vars.bookingId] });
      queryClient.invalidateQueries({ queryKey: ["booking-staff-assignments", vars.bookingId] });
      // The DB recomputes Pre-Event Ready on every response (ClickUp 86e3zjfq6).
      queryClient.invalidateQueries({ queryKey: ["booking-readiness", vars.bookingId] });
      queryClient.invalidateQueries({ queryKey: ["booking", vars.bookingId] });
      queryClient.invalidateQueries({ queryKey: ["bookings"] });
    },
  });
}


/** E-1 (86e40ach2): services the office added after booking and the guest
 * already paid (add-on invoices). Read through an RPC because the staff portal
 * cannot read booking_addon_invoices directly. The booking row is never
 * changed for these, so they are shown apart from the original add-ons. */
export interface StaffPaidAddon {
  id: string;
  paid_at: string | null;
  package: string | null;
  package_start_time: string | null;
  package_end_time: string | null;
  setup_breakdown: boolean | null;
  tablecloths: boolean | null;
  tablecloth_quantity: number | null;
  bar_package: string | null;
  bar_package_label: string | null;
}

export function useStaffPaidAddons(bookingId: string | undefined) {
  const { staffMember } = useStaffSession();

  return useQuery({
    queryKey: ["staff-paid-addons", staffMember?.id, bookingId],
    enabled: !!staffMember?.id && !!bookingId,
    queryFn: async () => {
      const rpc = supabase.rpc as unknown as (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: { message: string } | null }>;
      const { data, error } = await rpc("staff_get_paid_addons", {
        p_staff_id: staffMember!.id,
        p_booking_id: bookingId,
      });
      if (error) throw error;
      return (Array.isArray(data) ? data : []) as StaffPaidAddon[];
    },
  });
}
