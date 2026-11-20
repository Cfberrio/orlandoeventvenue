import { supabase } from "@/integrations/supabase/client";
import { orlandoDayRange } from "@/lib/orlandoDay";

/**
 * Revenue Data Hook
 *
 * Every Reports number comes from one ledger in the DB
 * (_revenue_ledger_unchecked, migration 20261119140000), dated by the Orlando
 * day the money moved. ClickUp 86e40ach2 R2-1..R2-11:
 *   Collected (net) = booking revenue lines + standalone/recurring invoices
 *                     + money kept on cancelled bookings (recorded decision)
 *   Card fees       = what guests paid on top (deposit/balance/add-on/invoice)
 *   Gross           = net + card fees (what Stripe charged)
 * Externals (paid on platform) and cancelled bookings without a refund
 * decision are returned apart and never added to Collected.
 */

// The generated Supabase types predate 20261119140000; these RPCs are typed here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (fn: string, args: Record<string, unknown>) => (supabase.rpc as any)(fn, args);

export interface RevenueSummary {
  booking_count: number;
  payment_days: number;
  booking_revenue: number;
  discount_amount: number;
  invoice_revenue: number;
  invoice_count: number;
  cancelled_kept_revenue: number;
  cancelled_kept_count: number;
  collected_net: number;
  card_fees: number;
  collected_gross: number;
  cancelled_unrecorded_amount: number;
  cancelled_unrecorded_count: number;
  external_amount: number;
  external_count: number;
}

interface CollectedColumns {
  /** Booking revenue lines only (net of discounts). */
  total_revenue: number;
  booking_count: number;
  baseline_revenue: number;
  cleaning_revenue: number;
  production_revenue: number;
  addon_revenue: number;
  bar_revenue: number;
  other_revenue: number;
  discount_amount: number;
  invoice_revenue: number;
  cancelled_kept_revenue: number;
  collected_net: number;
  card_fees: number;
  collected_gross: number;
  cancelled_unrecorded_amount: number;
  external_amount: number;
}

export interface DailyRevenueRecord extends CollectedColumns {
  revenue_date: string;
}

export interface MonthlyRevenueRecord extends CollectedColumns {
  revenue_month: string;
  year_month: string;
  cancelled_unrecorded_count: number;
  external_count: number;
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
  external_amount: number;
  external_count: number;
}

export interface DailyGeneratedRevenueRecord {
  generated_date: string;
  booking_count: number;
  total_generated: number;
  baseline_generated: number;
  cleaning_generated: number;
  production_generated: number;
  addon_generated: number;
  bar_generated: number;
  tax_generated: number;
  discount_generated: number;
}

export interface PaidInvoiceRecord {
  id: string;
  invoice_number: string;
  title: string;
  amount: number;
  processing_fee: number | null;
  total_charged: number | null;
  paid_offline_method: string | null;
  customer_email: string;
  customer_name: string | null;
  paid_at: string;
  line_items: { label: string; amount: number }[] | null;
}

export interface RevenueLineItem {
  source: string;
  counted_as: string;
  reservation_number: string | null;
  invoice_number: string | null;
  event_date: string | null;
  payment_date: string;
  payment_split: string | null;
  event_type: string | null;
  booking_type: string | null;
  booking_origin: string | null;
  guest_name: string | null;
  item_category: string;
  item_type: string | null;
  amount: number;
  quantity: number | null;
  description: string | null;
  created_at: string;
}

export interface ExportResult {
  success: boolean;
  /** true when the range had nothing to export (R2-20). */
  empty?: boolean;
  error: unknown;
}

export const NO_ROWS_MESSAGE = "No rows in this range";

/** Build the CSV text. Returns null when there are no rows. */
export function toCsv(data: Record<string, unknown>[]): string | null {
  if (!data || data.length === 0) return null;
  const headers = Object.keys(data[0]);
  return [
    headers.join(","),
    ...data.map((row) =>
      headers
        .map((header) => {
          const value = row[header];
          if (value === null || value === undefined) return "";
          const stringValue = String(value);
          if (stringValue.includes(",") || stringValue.includes('"') || stringValue.includes("\n")) {
            return `"${stringValue.replace(/"/g, '""')}"`;
          }
          return stringValue;
        })
        .join(","),
    ),
  ].join("\n");
}

/** Download rows as CSV. Returns false (and downloads nothing) when empty. */
export function downloadCsv(data: Record<string, unknown>[], filename: string): boolean {
  const csvContent = toCsv(data);
  if (csvContent === null) return false;
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  return true;
}

export function useRevenueData() {
  const call = async <T,>(fn: string, args: Record<string, unknown>, label: string) => {
    const { data, error } = await rpc(fn, args);
    if (error) {
      console.error(`Error fetching ${label}:`, error);
      return { data: null as T | null, error };
    }
    return { data: data as T, error: null };
  };

  const fetchRevenueSummary = async (startDate: string, endDate: string) => {
    const res = await call<RevenueSummary[]>(
      "get_revenue_summary",
      { p_start_date: startDate, p_end_date: endDate },
      "revenue summary",
    );
    return { data: res.data?.[0] ?? null, error: res.error };
  };

  const fetchDailyRevenue = (startDate: string, endDate: string) =>
    call<DailyRevenueRecord[]>("get_daily_revenue", { p_start_date: startDate, p_end_date: endDate }, "daily revenue");

  const fetchMonthlyRevenue = (startDate: string, endDate: string) =>
    call<MonthlyRevenueRecord[]>("get_monthly_revenue", { p_start_date: startDate, p_end_date: endDate }, "monthly revenue");

  const fetchRevenueByCategory = (startDate: string, endDate: string) =>
    call<CategoryRevenueRecord[]>(
      "get_revenue_by_category",
      { p_start_date: startDate, p_end_date: endDate },
      "revenue by category",
    );

  const fetchRevenueBySegment = (
    startDate: string,
    endDate: string,
    segmentBy: "booking_origin" | "event_type" | "booking_type",
  ) =>
    call<SegmentRevenueRecord[]>(
      "get_revenue_by_segment",
      { p_start_date: startDate, p_end_date: endDate, p_segment_by: segmentBy },
      "revenue by segment",
    );

  /** Booked value by booking-creation day (deposit paid, not cancelled). */
  const fetchDailyGeneratedRevenue = (startDate: string, endDate: string) =>
    call<DailyGeneratedRevenueRecord[]>(
      "get_daily_generated_revenue",
      { p_start_date: startDate, p_end_date: endDate },
      "daily generated revenue",
    );

  const fetchRevenueLineItems = (startDate: string, endDate: string) =>
    call<RevenueLineItem[]>(
      "get_revenue_line_items_export",
      { p_start_date: startDate, p_end_date: endDate },
      "revenue line items",
    );

  const exportRevenueCsv = async (startDate: string, endDate: string): Promise<ExportResult> => {
    const { data, error } = await fetchRevenueLineItems(startDate, endDate);
    if (error || !data) return { success: false, error };
    if (data.length === 0) return { success: false, empty: true, error: { message: NO_ROWS_MESSAGE } };
    const ok = downloadCsv(data as unknown as Record<string, unknown>[], `revenue-export-${startDate}-to-${endDate}.csv`);
    return ok ? { success: true, error: null } : { success: false, empty: true, error: { message: NO_ROWS_MESSAGE } };
  };

  /**
   * Bookings created on an Orlando day, with the same filter as
   * get_daily_generated_revenue: website, deposit paid, not cancelled (R2-15).
   */
  const fetchBookingsByCreatedDate = async (date: string) => {
    const range = orlandoDayRange(date, date);
    const { data, error } = await supabase
      .from("bookings")
      .select(
        "id, reservation_number, full_name, email, event_date, event_type, booking_type, total_amount, base_rental, cleaning_fee, package_cost, optional_services, bar_subtotal, taxes_fees, discount_amount, payment_status, status, lifecycle_status, deposit_paid_at, created_at",
      )
      .eq("booking_origin", "website")
      .not("status", "in", '("cancelled","declined")')
      .not("deposit_paid_at", "is", null)
      .gte("created_at", range.gte!)
      .lt("created_at", range.lt!)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Error fetching bookings by date:", error);
      return { data: null, error };
    }
    return { data: (data || []).filter((b) => b.lifecycle_status !== "cancelled"), error: null };
  };

  /** Paid invoices whose payment falls on the Orlando days from..to (R2-9). */
  const fetchPaidInvoices = async (startDate: string, endDate: string) => {
    const range = orlandoDayRange(startDate, endDate);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from("invoices")
      .select(
        "id, invoice_number, title, amount, processing_fee, total_charged, paid_offline_method, customer_email, customer_name, paid_at, line_items",
      )
      .eq("payment_status", "paid")
      .is("voided_at", null)
      .gte("paid_at", range.gte)
      .lt("paid_at", range.lt)
      .order("paid_at", { ascending: true });

    if (error) {
      console.error("Error fetching paid invoices:", error);
      return { data: null, error };
    }
    return { data: data as PaidInvoiceRecord[], error: null };
  };

  return {
    fetchRevenueSummary,
    fetchDailyRevenue,
    fetchDailyGeneratedRevenue,
    fetchMonthlyRevenue,
    fetchRevenueByCategory,
    fetchRevenueBySegment,
    fetchRevenueLineItems,
    exportRevenueCsv,
    downloadCsv,
    fetchBookingsByCreatedDate,
    fetchPaidInvoices,
  };
}
