import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface StandaloneCleaningReport {
  id: string;
  assignment_id: string;
  cleaner_id: string;
  cleaner_name: string;
  cleaner_role: string;
  
  // Checklist (10 items)
  clean_check_floors_swept_mopped: boolean;
  clean_check_bathrooms_cleaned: boolean;
  clean_check_kitchen_cleaned: boolean;
  clean_check_trash_removed: boolean;
  clean_check_equipment_stored: boolean;
  clean_check_tables_chairs_arranged: boolean;
  clean_check_lights_off: boolean;
  clean_check_office_door_locked: boolean;
  clean_check_front_door_locked: boolean;
  clean_check_deep_cleaning_done: boolean;
  
  // Media uploads (JSON arrays with Supabase Storage URLs)
  media_front_door: string[];
  media_main_area: string[];
  media_rack: string[];
  media_bathrooms: string[];
  media_kitchen: string[];
  media_deep_cleaning: string[];
  
  // Issues & Inventory
  issues_found: boolean;
  issues_notes: string | null;
  inventory_update_needed: boolean;
  inventory_items: Array<{ name: string; quantity: number }>;
  damage_found: boolean;
  damage_description: string | null;
  
  // Status & timestamps
  status: 'pending' | 'completed';
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface StandaloneAssignment {
  id: string;
  scheduled_date: string;
  scheduled_start_time: string | null;
  scheduled_end_time: string | null;
  cleaning_type: string | null;
  celebration_surcharge: number | null;
  status: string;
  notes: string | null;
}

/**
 * Get cleaning report for standalone assignment
 */
export function useStandaloneCleaningReport(assignmentId: string) {
  return useQuery({
    queryKey: ["standalone-cleaning-report", assignmentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("standalone_cleaning_reports")
        .select("*")
        .eq("assignment_id", assignmentId)
        .maybeSingle();
      
      if (error) throw error;
      return data as StandaloneCleaningReport | null;
    },
    enabled: !!assignmentId,
  });
}

/**
 * Get standalone assignment details
 */
export function useStandaloneAssignment(assignmentId: string) {
  return useQuery({
    queryKey: ["standalone-assignment", assignmentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("booking_staff_assignments")
        .select("*")
        .eq("id", assignmentId)
        .is("booking_id", null)
        .maybeSingle();
      
      if (error) throw error;
      return data as StandaloneAssignment | null;
    },
    enabled: !!assignmentId,
  });
}

/**
 * Create or update standalone cleaning report
 */
export function useUpdateStandaloneCleaningReport() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({
      assignmentId,
      reportData,
    }: {
      assignmentId: string;
      reportData: Partial<StandaloneCleaningReport>;
    }) => {
      // Check if report exists
      const { data: existing } = await supabase
        .from("standalone_cleaning_reports")
        .select("id")
        .eq("assignment_id", assignmentId)
        .maybeSingle();
      
      if (existing) {
        // Update existing
        const { data, error } = await supabase
          .from("standalone_cleaning_reports")
          .update(reportData)
          .eq("id", existing.id)
          .select()
          .single();
        
        if (error) throw error;
        return data;
      } else {
        // Create new
        const { data, error } = await supabase
          .from("standalone_cleaning_reports")
          .insert({ ...reportData, assignment_id: assignmentId })
          .select()
          .single();
        
        if (error) throw error;
        return data;
      }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ 
        queryKey: ["standalone-cleaning-report", variables.assignmentId] 
      });
      queryClient.invalidateQueries({
        queryKey: ["staff-standalone-assignments"]
      });
    },
  });
}

/**
 * Get staff's own standalone assignments
 */
export function useStaffStandaloneAssignments() {
  return useQuery({
    queryKey: ["staff-standalone-assignments"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      
      const { data, error } = await supabase
        .from("booking_staff_assignments")
        .select(`
          id,
          scheduled_date,
          scheduled_start_time,
          scheduled_end_time,
          cleaning_type,
          celebration_surcharge,
          status,
          notes
        `)
        .eq("staff_id", user.id)
        .is("booking_id", null)
        .order("scheduled_date", { ascending: false });
      
      if (error) throw error;
      return data as StandaloneAssignment[];
    },
  });
}

/**
 * Upload media file to Supabase Storage
 */
export async function uploadStandaloneCleaningMedia(
  assignmentId: string,
  file: File,
  category: 'front_door' | 'main_area' | 'rack' | 'bathrooms' | 'kitchen' | 'deep_cleaning'
): Promise<string> {
  const fileExt = file.name.split('.').pop();
  const fileName = `${assignmentId}/${category}/${Date.now()}.${fileExt}`;
  const filePath = `standalone-cleaning-reports/${fileName}`;

  const { error: uploadError } = await supabase.storage
    .from('booking-cleaning-reports')
    .upload(filePath, file);

  if (uploadError) throw uploadError;

  const { data: { publicUrl } } = supabase.storage
    .from('booking-cleaning-reports')
    .getPublicUrl(filePath);

  return publicUrl;
}

/**
 * Delete media file from Supabase Storage
 */
export async function deleteStandaloneCleaningMedia(url: string): Promise<void> {
  const urlObj = new URL(url);
  const pathParts = urlObj.pathname.split('/booking-cleaning-reports/');
  if (pathParts.length < 2) throw new Error("Invalid media URL");
  
  const filePath = pathParts[1];

  const { error } = await supabase.storage
    .from('booking-cleaning-reports')
    .remove([filePath]);

  if (error) throw error;
}
