import { supabase } from "@/integrations/supabase/client";

/**
 * Revenue Data Hook
 * 
 * Provides functions to fetch revenue data from the database
 * using the SQL helper functions created in the migrations.
 */

export interface DailyRevenueRecord {
  revenue_date: string;
  total_revenue: number;
  booking_count: number;
  baseline_revenue: number;
  cleaning_revenue: number;
  production_revenue: number;
  addon_revenue: number;
  fee_revenue: number;
  discount_amount: number;
  tax_amount: number;
}

export interface MonthlyRevenueRecord {
  revenue_month: string;
  year_month: string;
  total_revenue: number;
  booking_count: number;
  baseline_revenue: number;
  cleaning_revenue: number;
  production_revenue: number;
  addon_revenue: number;
}

export interface CategoryRevenueRecord {
  category: string;
  item_type: string;
  total_amount: number;
  item_count: number;
}

export interface SegmentRevenueRecord {
  segment: string;
  total_revenue: number;
  booking_count: number;
  avg_revenue: number;
}

export interface RevenueLineItem {
  reservation_number: string;
  event_date: string;
  event_type: string;
  booking_type: string;
  booking_origin: string;
  guest_name: string;
  item_category: string;
  item_type: string;
  amount: number;
  quantity: number | null;
  description: string;
  created_at: string;
}

export function useRevenueData() {
  /**
   * Fetch daily revenue breakdown
   */
  const fetchDailyRevenue = async (startDate: string, endDate: string) => {
    const { data, error } = await supabase.rpc('get_daily_revenue', {
      p_start_date: startDate,
      p_end_date: endDate
    });
    
    if (error) {
      console.error('Error fetching daily revenue:', error);
      return { data: null, error };
    }
    
    return { data: data as DailyRevenueRecord[], error: null };
  };

  /**
   * Fetch monthly revenue breakdown
   */
  const fetchMonthlyRevenue = async (startDate: string, endDate: string) => {
    const { data, error } = await supabase.rpc('get_monthly_revenue', {
      p_start_date: startDate,
      p_end_date: endDate
    });
    
    if (error) {
      console.error('Error fetching monthly revenue:', error);
      return { data: null, error };
    }
    
    return { data: data as MonthlyRevenueRecord[], error: null };
  };

  /**
   * Fetch revenue by category
   */
  const fetchRevenueByCategory = async (startDate: string, endDate: string) => {
    const { data, error } = await supabase.rpc('get_revenue_by_category', {
      p_start_date: startDate,
      p_end_date: endDate
    });
    
    if (error) {
      console.error('Error fetching revenue by category:', error);
      return { data: null, error };
    }
    
    return { data: data as CategoryRevenueRecord[], error: null };
  };

  /**
   * Fetch revenue by segment
   */
  const fetchRevenueBySegment = async (
    startDate: string, 
    endDate: string, 
    segmentBy: 'booking_origin' | 'event_type' | 'booking_type'
  ) => {
    const { data, error } = await supabase.rpc('get_revenue_by_segment', {
      p_start_date: startDate,
      p_end_date: endDate,
      p_segment_by: segmentBy
    });
    
    if (error) {
      console.error('Error fetching revenue by segment:', error);
      return { data: null, error };
    }
    
    return { data: data as SegmentRevenueRecord[], error: null };
  };

  /**
   * Fetch all line items for export
   */
  const fetchRevenueLineItems = async (startDate: string, endDate: string) => {
    const { data, error } = await supabase.rpc('get_revenue_line_items_export', {
      p_start_date: startDate,
      p_end_date: endDate
    });
    
    if (error) {
      console.error('Error fetching revenue line items:', error);
      return { data: null, error };
    }
    
    return { data: data as RevenueLineItem[], error: null };
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
   * Export revenue to CSV
   */
  const exportRevenueCsv = async (startDate: string, endDate: string) => {
    const { data, error } = await fetchRevenueLineItems(startDate, endDate);
    
    if (error || !data) {
      return { success: false, error };
    }
    
    downloadCsv(data, `revenue-export-${startDate}-to-${endDate}.csv`);
    return { success: true, error: null };
  };

  return {
    fetchDailyRevenue,
    fetchMonthlyRevenue,
    fetchRevenueByCategory,
    fetchRevenueBySegment,
    fetchRevenueLineItems,
    exportRevenueCsv,
    downloadCsv,
  };
}
