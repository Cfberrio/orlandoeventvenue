import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useStaffSession } from "./useStaffSession";

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

/** ST2-02: standalone photos go to the existing public cleaning-media bucket
 * (the old "booking-cleaning-reports" bucket never existed in production). */
export const STANDALONE_MEDIA_BUCKET = "cleaning-media";

/**
 * Get cleaning report for standalone assignment.
 * ST2-27: staff are anonymous, so the table policy (cleaner_id = auth.uid())
 * never matched and the form always opened blank. The RPC checks the job is
 * this staff member's and returns the saved report.
 */
export function useStandaloneCleaningReport(assignmentId: string) {
  const { staffMember } = useStaffSession();
  return useQuery({
    queryKey: ["standalone-cleaning-report", assignmentId, staffMember?.id],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("staff_get_standalone_cleaning_report", {
        p_staff_id: staffMember!.id,
        p_assignment_id: assignmentId,
      });
      if (error) throw error;
      return (data ?? null) as StandaloneCleaningReport | null;
    },
    enabled: !!assignmentId && !!staffMember?.id,
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
  const { staffMember } = useStaffSession();

  return useMutation({
    mutationFn: async ({
      assignmentId,
      reportData,
    }: {
      assignmentId: string;
      reportData: Partial<StandaloneCleaningReport>;
    }) => {
      if (!staffMember?.id) throw new Error("Your staff session expired; sign in again");
      // E-12 (86e40ach2): staff portal users are anonymous, so the old insert
      // (cleaner_id = auth.uid()) could never succeed. The server checks the
      // assignment belongs to this staff member and saves the report.
      const { data, error } = await supabase.rpc("staff_submit_standalone_cleaning_report" as any, {
        p_staff_id: staffMember.id,
        p_assignment_id: assignmentId,
        p_report: reportData,
      });
      if (error) throw error;
      return data as { report_id: string; ticket_id: string | null; inventory_lines: number };
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
  const { staffMember } = useStaffSession();
  
  return useQuery({
    queryKey: ["staff-standalone-assignments", staffMember?.id],
    queryFn: async () => {
      if (!staffMember?.id) return [];
      
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
        .eq("staff_id", staffMember.id)
        .is("booking_id", null)
        // ST2-27: a cancelled job has nothing to report.
        .neq("status", "cancelled")
        .order("scheduled_date", { ascending: false });
      
      if (error) throw error;
      return data as StandaloneAssignment[];
    },
    enabled: !!staffMember?.id,
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
    .from(STANDALONE_MEDIA_BUCKET)
    .upload(filePath, file);

  if (uploadError) throw uploadError;

  const { data: { publicUrl } } = supabase.storage
    .from(STANDALONE_MEDIA_BUCKET)
    .getPublicUrl(filePath);

  return publicUrl;
}

// Removing a photo only drops it from the report (same as the booking
// cleaning form); staff cannot delete stored files (S-10 interim, ST2-23).
