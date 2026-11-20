import { supabase } from "@/integrations/supabase/client";

/**
 * Payroll Data Hook
 * 
 * Provides functions to fetch and manage payroll data
 */

export interface PayrollByStaff {
  staff_id: string;
  staff_name: string;
  staff_role: string;
  payroll_type: string;
  total_amount: number;
  assignment_count: number;
  hours_worked: number;
  avg_per_assignment: number;
}

export interface PayrollByRole {
  staff_role: string;
  payroll_type: string;
  staff_count: number;
  total_amount: number;
  assignment_count: number;
  hours_worked: number;
  avg_per_staff: number;
  avg_per_assignment: number;
}

export interface PayrollLineItem {
  staff_name: string;
  staff_role: string;
  payroll_type: string;
  assignment_date: string;
  booking_id: string | null;
  assignment_id: string;
  reservation_number: string | null;
  assignment_type: string;
  pay_category: string;
  pay_type: string;
  amount: number;
  hours: number | null;
  rate: number | null;
  description: string;
  assignment_status: string;
  paid_status: string;
  paid_at: string | null;
  payroll_item_id: string;
  created_at: string;
}

export interface StandaloneAssignmentData {
  staff_id: string;
  scheduled_date: string;
  scheduled_start_time?: string;
  scheduled_end_time?: string;
  cleaning_type: 'touch_up' | 'regular' | 'deep';
  celebration_surcharge?: number;
  notes?: string;
  status: 'assigned' | 'in_progress' | 'completed';
}

export function usePayrollData() {
  /**
   * Fetch payroll by staff member
   */
  const fetchPayrollByStaff = async (
    startDate: string, 
    endDate: string, 
    staffId?: string
  ) => {
    const { data, error } = await supabase.rpc('get_payroll_by_staff', {
      p_start_date: startDate,
      p_end_date: endDate,
      p_staff_id: staffId || null
    });
    
    if (error) {
      console.error('Error fetching payroll by staff:', error);
      return { data: null, error };
    }
    
    return { data: data as PayrollByStaff[], error: null };
  };

  /**
   * Fetch payroll by role
   */
  const fetchPayrollByRole = async (startDate: string, endDate: string) => {
    const { data, error } = await supabase.rpc('get_payroll_by_role', {
      p_start_date: startDate,
      p_end_date: endDate
    });
    
    if (error) {
      console.error('Error fetching payroll by role:', error);
      return { data: null, error };
    }
    
    return { data: data as PayrollByRole[], error: null };
  };

  /**
   * Fetch payroll line items
   */
  const fetchPayrollLineItems = async (startDate: string, endDate: string) => {
    const { data, error } = await supabase.rpc('get_payroll_line_items_export', {
      p_start_date: startDate,
      p_end_date: endDate
    });
    
    if (error) {
      console.error('Error fetching payroll line items:', error);
      return { data: null, error };
    }
    
    return { data: data as PayrollLineItem[], error: null };
  };

  /**
   * Create standalone assignment
   */
  const createStandaloneAssignment = async (data: StandaloneAssignmentData) => {
    const { data: assignment, error } = await supabase
      .from('booking_staff_assignments')
      .insert({
        booking_id: null, // Standalone
        staff_id: data.staff_id,
        assignment_type: 'cleaning',
        assignment_role: 'cleaner',
        cleaning_type: data.cleaning_type,
        celebration_surcharge: data.celebration_surcharge || 0,
        scheduled_date: data.scheduled_date,
        scheduled_start_time: data.scheduled_start_time,
        scheduled_end_time: data.scheduled_end_time,
        notes: data.notes,
        status: data.status,
        completed_at: data.status === 'completed' ? new Date().toISOString() : null
      })
      .select()
      .single();
    
    if (error) {
      console.error('Error creating standalone assignment:', error);
      return { data: null, error };
    }
    
    return { data: assignment, error: null };
  };

  /**
   * Update assignment (for editing hours, cleaning_type, etc.)
   */
  const updateAssignment = async (assignmentId: string, updates: any) => {
    const { data, error } = await supabase
      .from('booking_staff_assignments')
      .update(updates)
      .eq('id', assignmentId)
      .select()
      .single();
    
    if (error) {
      console.error('Error updating assignment:', error);
      return { data: null, error };
    }
    
    return { data, error: null };
  };

  /**
   * Recalculate payroll for an assignment
   */
  const recalculatePayroll = async (assignmentId: string) => {
    const { error } = await supabase.rpc('populate_staff_payroll_items', {
      p_assignment_id: assignmentId,
      p_is_historical: false
    });
    
    if (error) {
      console.error('Error recalculating payroll:', error);
      return { success: false, error };
    }
    
    return { success: true, error: null };
  };

  /**
   * Add bonus to an assignment
   */
  const addBonus = async (
    assignmentId: string,
    staffId: string,
    amount: number,
    description: string
  ) => {
    const { error } = await supabase
      .from('staff_payroll_items')
      .insert({
        assignment_id: assignmentId,
        staff_id: staffId,
        pay_category: 'bonus',
        pay_type: 'manual',
        amount: amount,
        description: description,
        is_historical: false
      });
    
    if (error) {
      console.error('Error adding bonus:', error);
      return { success: false, error };
    }
    
    return { success: true, error: null };
  };

  /**
   * Add deduction to an assignment
   */
  const addDeduction = async (
    assignmentId: string,
    staffId: string,
    amount: number,
    description: string
  ) => {
    const { error } = await supabase
      .from('staff_payroll_items')
      .insert({
        assignment_id: assignmentId,
        staff_id: staffId,
        pay_category: 'deduction',
        pay_type: 'manual',
        amount: -1 * Math.abs(amount), // Always negative
        description: description,
        is_historical: false
      });
    
    if (error) {
      console.error('Error adding deduction:', error);
      return { success: false, error };
    }
    
    return { success: true, error: null };
  };

  /**
   * Mark payroll items as paid
   */
  const markAsPaid = async (payrollItemIds: string[], _paidBy: string) => {
    const { data, error } = await supabase
      .from('staff_payroll_items')
      .update({ 
        paid_status: 'paid',
        paid_at: new Date().toISOString(),
      } as any)
      .in('id', payrollItemIds)
      .select('id');
    
    // E-6 (86e40ach2): callers ignored the result, so a failed or blocked
    // update still showed success. Fail loudly instead.
    if (error) throw new Error(`Not marked as paid: ${error.message}`);
    const count = data?.length || 0;
    if (count !== payrollItemIds.length) {
      throw new Error(`Only ${count} of ${payrollItemIds.length} line(s) were marked as paid; reload and check.`);
    }
    return { success: true, count, error: null };
  };

  /**
   * Mark payroll items as unpaid (revert)
   */
  const markAsUnpaid = async (payrollItemIds: string[]) => {
    const { data, error } = await supabase
      .from('staff_payroll_items')
      .update({ 
        paid_status: 'pending',
        paid_at: null,
      } as any)
      .in('id', payrollItemIds)
      .select('id');
    
    // E-6 (86e40ach2): callers ignored the result, so a failed or blocked
    // update still showed success. Fail loudly instead.
    if (error) throw new Error(`Not marked as unpaid: ${error.message}`);
    const count = data?.length || 0;
    if (count !== payrollItemIds.length) {
      throw new Error(`Only ${count} of ${payrollItemIds.length} line(s) were marked as unpaid; reload and check.`);
    }
    return { success: true, count, error: null };
  };

  /**
   * Delete standalone assignment
   */
  const deleteStandaloneAssignment = async (assignmentId: string) => {
    // Verify it's a standalone (booking_id is null)
    const { data: assignment } = await supabase
      .from('booking_staff_assignments')
      .select('booking_id')
      .eq('id', assignmentId)
      .single();
    
    if (assignment?.booking_id) {
      return { 
        success: false, 
        error: { message: 'Cannot delete booking-linked assignment. This is not a standalone assignment.' }
      };
    }
    
    // ST2-19: refuses paid work and records the delete (staff_assignment_deletions).
    const { error } = await supabase.rpc('admin_delete_staff_assignment' as never, {
      p_assignment_id: assignmentId,
      p_reason: 'Standalone job deleted in Payroll',
    } as never);

    if (error) {
      console.error('Error deleting standalone assignment:', error);
      return { success: false, error };
    }

    return { success: true, error: null };
  };

  /**
   * Helper to convert data to CSV and trigger download
   */
  const downloadCsv = (data: any[], filename: string) => {
    if (!data || data.length === 0) {
      console.error('No data to export');
      return;
    }

    // Get headers from first object
    const headers = Object.keys(data[0]);
    
    // Build CSV content
    const csvContent = [
      headers.join(','), // Header row
      ...data.map(row => 
        headers.map(header => {
          const value = row[header];
          // Handle values that might contain commas or quotes
          if (value === null || value === undefined) return '';
          const stringValue = String(value);
          if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
            return `"${stringValue.replace(/"/g, '""')}"`;
          }
          return stringValue;
        }).join(',')
      )
    ].join('\n');

    // Create blob and download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    URL.revokeObjectURL(url);
  };

  /**
   * Export payroll to CSV
   */
  const exportPayrollCsv = async (
    startDate: string, 
    endDate: string,
    filters?: {
      paidStatus?: 'pending' | 'paid' | 'all';
      staffId?: string;
      role?: string;
    }
  ) => {
    const { data, error } = await fetchPayrollLineItems(startDate, endDate);
    
    if (error || !data) {
      return { success: false, error };
    }
    
    // Apply filters
    let filteredData = data;
    
    if (filters?.paidStatus && filters.paidStatus !== 'all') {
      filteredData = filteredData.filter(item => item.paid_status === filters.paidStatus);
    }
    
    if (filters?.staffId) {
      // C-25: the export rows carry staff_name, not staff_id; comparing the name
      // with the id always produced an empty file. Resolve the id to its name.
      const { data: staff, error: staffError } = await supabase
        .from("staff_members")
        .select("full_name")
        .eq("id", filters.staffId)
        .maybeSingle();
      if (staffError || !staff) {
        return { success: false, error: staffError ?? new Error("Staff member not found") };
      }
      filteredData = filteredData.filter(item => item.staff_name === staff.full_name);
    }
    
    if (filters?.role) {
      filteredData = filteredData.filter(item => item.staff_role === filters.role);
    }
    
    const filename = `payroll-export-${startDate}-to-${endDate}.csv`;
    downloadCsv(filteredData, filename);
    
    return { success: true, error: null };
  };

  return {
    // Fetch functions
    fetchPayrollByStaff,
    fetchPayrollByRole,
    fetchPayrollLineItems,
    
    // CRUD operations
    createStandaloneAssignment,
    updateAssignment,
    deleteStandaloneAssignment,
    
    // Payroll operations
    recalculatePayroll,
    addBonus,
    addDeduction,
    markAsPaid,
    markAsUnpaid,
    
    // Export
    exportPayrollCsv,
    downloadCsv,
  };
}
