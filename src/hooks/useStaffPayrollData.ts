import { supabase } from "@/integrations/supabase/client";
import { PayrollByStaff, PayrollLineItem } from "@/hooks/usePayrollData";

/**
 * Staff Payroll Data Hook
 *
 * Provides functions for staff members to view their own payroll data.
 * Uses a dedicated RPC (get_staff_payroll_line_items) that enforces
 * server-side filtering by staff_id for security.
 */

export function useStaffPayrollData() {
  /**
   * Fetch payroll summary for a specific staff member
   */
  const fetchStaffPayrollSummary = async (
    staffId: string,
    startDate: string,
    endDate: string
  ) => {
    const { data, error } = await supabase.rpc("get_payroll_by_staff", {
      p_start_date: startDate,
      p_end_date: endDate,
      p_staff_id: staffId,
    });

    if (error) {
      console.error("Error fetching staff payroll summary:", error);
      return { data: null, error };
    }

    return { data: data as PayrollByStaff[], error: null };
  };

  /**
   * Fetch payroll line items for a specific staff member.
   * Uses dedicated RPC that requires staff_id (server-side filter).
   */
  const fetchStaffPayrollLineItems = async (
    staffId: string,
    startDate: string,
    endDate: string
  ) => {
    const { data, error } = await supabase.rpc("get_staff_payroll_line_items", {
      p_staff_id: staffId,
      p_start_date: startDate,
      p_end_date: endDate,
    });

    if (error) {
      console.error("Error fetching staff payroll line items:", error);
      return { data: null, error };
    }

    return { data: data as PayrollLineItem[], error: null };
  };

  /**
   * Export staff payroll to CSV with optional filters
   */
  const exportStaffPayrollCsv = async (
    staffId: string,
    startDate: string,
    endDate: string,
    filters?: {
      paidStatus?: "pending" | "paid" | "all";
      assignmentType?: "cleaning" | "production" | "all";
    }
  ) => {
    const { data, error } = await fetchStaffPayrollLineItems(
      staffId,
      startDate,
      endDate
    );

    if (error || !data) {
      return { success: false, error };
    }

    let filteredData = data;

    if (filters?.paidStatus && filters.paidStatus !== "all") {
      filteredData = filteredData.filter(
        (item) => item.paid_status === filters.paidStatus
      );
    }

    if (filters?.assignmentType && filters.assignmentType !== "all") {
      if (filters.assignmentType === "cleaning") {
        filteredData = filteredData.filter(
          (item) =>
            item.pay_category === "cleaning_base" ||
            item.pay_category === "cleaning_surcharge"
        );
      } else if (filters.assignmentType === "production") {
        filteredData = filteredData.filter(
          (item) => item.pay_category === "hourly_production"
        );
      }
    }

    if (filteredData.length === 0) {
      return { success: false, error: "No data to export" };
    }

    // Build CSV rows with human-readable columns
    const csvRows = filteredData.map((item) => ({
      Date: item.assignment_date,
      Type: item.assignment_type,
      Category: item.pay_category,
      "Pay Type": item.pay_type || "",
      Description: item.description || "",
      Booking: item.reservation_number || "Standalone",
      Hours: item.hours ?? "",
      Rate: item.rate ?? "",
      Amount: item.amount,
      Status: item.paid_status,
      "Paid At": item.paid_at || "",
    }));

    const headers = Object.keys(csvRows[0]);
    const csvContent = [
      headers.join(","),
      ...csvRows.map((row) =>
        headers
          .map((header) => {
            const value = (row as Record<string, unknown>)[header];
            if (value === null || value === undefined) return "";
            const stringValue = String(value);
            if (
              stringValue.includes(",") ||
              stringValue.includes('"') ||
              stringValue.includes("\n")
            ) {
              return `"${stringValue.replace(/"/g, '""')}"`;
            }
            return stringValue;
          })
          .join(",")
      ),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);

    link.setAttribute("href", url);
    link.setAttribute(
      "download",
      `my-payments-${startDate}-to-${endDate}.csv`
    );
    link.style.visibility = "hidden";

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(url);

    return { success: true, error: null };
  };

  return {
    fetchStaffPayrollSummary,
    fetchStaffPayrollLineItems,
    exportStaffPayrollCsv,
  };
}
