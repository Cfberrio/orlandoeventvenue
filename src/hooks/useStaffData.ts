import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

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
  client_notes: string | null;
  lifecycle_status: string;
  assignment_role: string;
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

// Get current staff member based on logged in user's email
export function useCurrentStaffMember() {
  return useQuery({
    queryKey: ["current-staff-member"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) return null;
      
      const { data, error } = await supabase
        .from("staff_members")
        .select("*")
        .eq("email", user.email)
        .maybeSingle();
      
      if (error) throw error;
      return data;
    },
  });
}

// Get bookings assigned to current staff member
export function useStaffAssignedBookings() {
  const { data: staffMember } = useCurrentStaffMember();
  
  return useQuery({
    queryKey: ["staff-assigned-bookings", staffMember?.id],
    queryFn: async () => {
      if (!staffMember?.id) return [];
      
      const { data, error } = await supabase
        .from("booking_staff_assignments")
        .select(`
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
            client_notes,
            lifecycle_status
          )
        `)
        .eq("staff_id", staffMember.id)
        .order("created_at", { ascending: false });
      
      if (error) throw error;
      
      // Transform the data to include assignment role with booking
      return (data || []).map((assignment: any) => ({
        ...assignment.bookings,
        assignment_role: assignment.assignment_role,
      })) as StaffBooking[];
    },
    enabled: !!staffMember?.id,
  });
}

// Get single booking detail for staff
export function useStaffBookingDetail(bookingId: string) {
  return useQuery({
    queryKey: ["staff-booking-detail", bookingId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select("*")
        .eq("id", bookingId)
        .maybeSingle();
      
      if (error) throw error;
      return data;
    },
    enabled: !!bookingId,
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
