import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useStaffSession } from "./useStaffSession";

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
          booking_id,
          bookings (
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
            lifecycle_status
          )
        `)
        .eq("staff_id", staffMember.id)
        .order("created_at", { ascending: false });
      
      if (error) throw error;
      
      // Transform the data to include assignment role and assignment_id with booking
      return (data || []).map((assignment: any) => ({
        ...assignment.bookings,
        assignment_role: assignment.assignment_role,
        assignment_id: assignment.id,
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
      
      // Get assignment role and id for this staff member
      const { data: assignmentData, error: assignmentError } = await supabase
        .from("booking_staff_assignments")
        .select("id, assignment_role")
        .eq("booking_id", bookingId)
        .eq("staff_id", staffMember.id)
        .maybeSingle();
      
      if (assignmentError) throw assignmentError;
      
      return {
        ...bookingData,
        assignment_role: assignmentData?.assignment_role || null,
        assignment_id: assignmentData?.id || null,
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
  
  return useMutation({
    mutationFn: async ({ 
      bookingId, 
      reportData 
    }: { 
      bookingId: string; 
      reportData: Partial<CleaningReport>;
    }) => {
      // Check if report exists
      const { data: existing } = await supabase
        .from("booking_cleaning_reports")
        .select("id")
        .eq("booking_id", bookingId)
        .maybeSingle();
      
      if (existing) {
        // Update existing
        const { data, error } = await supabase
          .from("booking_cleaning_reports")
          .update(reportData)
          .eq("id", existing.id)
          .select()
          .single();
        
        if (error) throw error;
        return data;
      } else {
        // Create new
        const { data, error } = await supabase
          .from("booking_cleaning_reports")
          .insert({ booking_id: bookingId, ...reportData })
          .select()
          .single();
        
        if (error) throw error;
        return data;
      }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["booking-cleaning-report", variables.bookingId] });
      queryClient.invalidateQueries({ queryKey: ["staff-assigned-bookings"] });
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
    mutationFn: async ({ bookingId, assignmentId }: { bookingId: string; assignmentId: string }) => {
      // Delete the assignment
      const { error: deleteError } = await supabase
        .from("booking_staff_assignments")
        .delete()
        .eq("id", assignmentId);
      
      if (deleteError) throw deleteError;
      
      // Create a booking event to notify admin
      const { error: eventError } = await supabase
        .from("booking_events")
        .insert({
          booking_id: bookingId,
          event_type: "staff_unassigned",
          channel: "system",
          metadata: {
            staff_name: staffMember?.full_name,
            staff_role: staffMember?.role,
            unassigned_at: new Date().toISOString(),
            reason: "Staff self-unassigned from booking",
          },
        });
      
      if (eventError) {
        console.error("Failed to create booking event:", eventError);
        // Don't throw here, assignment was deleted successfully
      }
      
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
        .select("booking_id, assignment_role")
        .eq("staff_id", staffMember.id);
      
      if (assignmentsError) throw assignmentsError;
      
      // Create a map of booking_id -> assignment_role
      const assignmentMap = new Map(
        assignmentsData?.map(a => [a.booking_id, a.assignment_role]) || []
      );
      
      // Filter bookings to only include those assigned to this staff member
      const bookings = (bookingsData || [])
        .filter(booking => assignmentMap.has(booking.id))
        .map(booking => ({
          ...booking,
          assignment_role: assignmentMap.get(booking.id),
        }));
      
      return { bookings };
    },
    enabled: !!staffMember?.id && !!dateFrom && !!dateTo,
  });
}
