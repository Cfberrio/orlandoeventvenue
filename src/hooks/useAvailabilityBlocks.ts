import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format, parseISO, isSameDay, isWithinInterval, addMonths, addDays } from "date-fns";

export interface AvailabilityBlock {
  id: string;
  source: "internal_admin" | "blackout" | "system";
  booking_id: string | null;
  block_type: "daily" | "hourly";
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  notes: string | null;
  created_at: string;
}

export interface CreateBlockInput {
  source: "internal_admin" | "blackout" | "system";
  booking_id?: string | null;
  block_type: "daily" | "hourly";
  start_date: string;
  end_date: string;
  start_time?: string | null;
  end_time?: string | null;
  notes?: string | null;
}

// Duration options for internal bookings
export type BlockDuration = "1_day" | "1_week" | "1_month" | "2_months";

// Calculate end date based on duration
export function calculateEndDate(startDate: Date, duration: BlockDuration): Date {
  switch (duration) {
    case "1_day":
      return startDate;
    case "1_week":
      return addDays(startDate, 6);
    case "1_month":
      return addDays(addMonths(startDate, 1), -1);
    case "2_months":
      return addDays(addMonths(startDate, 2), -1);
    default:
      return startDate;
  }
}

// Fetch all availability blocks
export function useAvailabilityBlocks(dateFrom?: string, dateTo?: string) {
  return useQuery({
    queryKey: ["availability-blocks", dateFrom, dateTo],
    queryFn: async (): Promise<AvailabilityBlock[]> => {
      let query = supabase.from("availability_blocks").select("*");
      
      if (dateFrom) {
        query = query.gte("end_date", dateFrom);
      }
      if (dateTo) {
        query = query.lte("start_date", dateTo);
      }
      
      const { data, error } = await query.order("start_date", { ascending: true });
      
      if (error) {
        console.error("Error fetching availability blocks:", error);
        throw error;
      }
      
      return (data || []) as AvailabilityBlock[];
    },
    staleTime: 1000 * 60 * 5,
  });
}

// Create a new availability block
export function useCreateAvailabilityBlock() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (input: CreateBlockInput) => {
      const { data, error } = await supabase
        .from("availability_blocks")
        .insert({
          source: input.source,
          booking_id: input.booking_id || null,
          block_type: input.block_type,
          start_date: input.start_date,
          end_date: input.end_date,
          start_time: input.start_time || null,
          end_time: input.end_time || null,
          notes: input.notes || null,
        })
        .select()
        .single();
      
      if (error) throw error;
      return data as AvailabilityBlock;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["availability-blocks"] });
      queryClient.invalidateQueries({ queryKey: ["booked-dates"] });
    },
  });
}

// Delete an availability block
export function useDeleteAvailabilityBlock() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (blockId: string) => {
      const { error } = await supabase
        .from("availability_blocks")
        .delete()
        .eq("id", blockId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["availability-blocks"] });
      queryClient.invalidateQueries({ queryKey: ["booked-dates"] });
    },
  });
}

// Helper: Convert time string to minutes for comparison
const toMinutes = (time: string): number => {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
};

// Check if a date falls within a block's date range
export function isDateInBlockRange(date: Date, block: AvailabilityBlock): boolean {
  const startDate = parseISO(block.start_date);
  const endDate = parseISO(block.end_date);
  
  return isWithinInterval(date, { start: startDate, end: endDate });
}

// Check if two time ranges overlap
export function doTimeRangesOverlap(
  start1: string,
  end1: string,
  start2: string,
  end2: string
): boolean {
  const start1Min = toMinutes(start1);
  const end1Min = toMinutes(end1);
  const start2Min = toMinutes(start2);
  const end2Min = toMinutes(end2);
  
  // Overlap exists if: start1 < end2 AND end1 > start2
  return start1Min < end2Min && end1Min > start2Min;
}

interface BookedSlot {
  event_date: string;
  booking_type: "hourly" | "daily";
  start_time: string | null;
  end_time: string | null;
}

interface BlackoutDate {
  start_date: string;
  end_date: string;
}

// Check if a date is available for DAILY booking
export function isDateAvailableForDaily(
  date: Date,
  blocks: AvailabilityBlock[],
  paidBookings: BookedSlot[],
  blackoutDates: BlackoutDate[]
): boolean {
  const dateStr = format(date, "yyyy-MM-dd");
  
  // Check blackout dates
  for (const blackout of blackoutDates) {
    const start = parseISO(blackout.start_date);
    const end = parseISO(blackout.end_date);
    if (isWithinInterval(date, { start, end })) {
      return false;
    }
  }
  
  // Check availability blocks (daily blocks that overlap this date)
  for (const block of blocks) {
    if (isDateInBlockRange(date, block)) {
      return false;
    }
  }
  
  // Check paid bookings (any booking on this date blocks it for daily)
  for (const booking of paidBookings) {
    if (isSameDay(parseISO(booking.event_date), date)) {
      return false;
    }
  }
  
  return true;
}

// Check if a date/time range is available for HOURLY booking
export function isTimeRangeAvailableForHourly(
  date: Date,
  startTime: string,
  endTime: string,
  blocks: AvailabilityBlock[],
  paidBookings: BookedSlot[],
  blackoutDates: BlackoutDate[]
): boolean {
  const dateStr = format(date, "yyyy-MM-dd");
  
  // Check blackout dates
  for (const blackout of blackoutDates) {
    const start = parseISO(blackout.start_date);
    const end = parseISO(blackout.end_date);
    if (isWithinInterval(date, { start, end })) {
      return false;
    }
  }
  
  // Check daily blocks (any daily block on this date blocks all times)
  for (const block of blocks) {
    if (block.block_type === "daily" && isDateInBlockRange(date, block)) {
      return false;
    }
  }
  
  // Check hourly blocks for time overlap
  for (const block of blocks) {
    if (
      block.block_type === "hourly" &&
      isSameDay(parseISO(block.start_date), date) &&
      block.start_time &&
      block.end_time
    ) {
      if (doTimeRangesOverlap(startTime, endTime, block.start_time, block.end_time)) {
        return false;
      }
    }
  }
  
  // Check paid daily bookings (block all times on that date)
  for (const booking of paidBookings) {
    if (booking.booking_type === "daily" && isSameDay(parseISO(booking.event_date), date)) {
      return false;
    }
  }
  
  // Check paid hourly bookings for time overlap
  for (const booking of paidBookings) {
    if (
      booking.booking_type === "hourly" &&
      isSameDay(parseISO(booking.event_date), date) &&
      booking.start_time &&
      booking.end_time
    ) {
      if (doTimeRangesOverlap(startTime, endTime, booking.start_time, booking.end_time)) {
        return false;
      }
    }
  }
  
  return true;
}

// Check if a date has any booking/block (for calendar display)
export function getDateBlockStatus(
  date: Date,
  blocks: AvailabilityBlock[],
  paidBookings: BookedSlot[],
  blackoutDates: BlackoutDate[]
): "available" | "partial" | "blocked" {
  const dateStr = format(date, "yyyy-MM-dd");
  
  // Check blackout dates first
  for (const blackout of blackoutDates) {
    const start = parseISO(blackout.start_date);
    const end = parseISO(blackout.end_date);
    if (isWithinInterval(date, { start, end })) {
      return "blocked";
    }
  }
  
  // Check daily blocks
  for (const block of blocks) {
    if (block.block_type === "daily" && isDateInBlockRange(date, block)) {
      return "blocked";
    }
  }
  
  // Check paid daily bookings
  for (const booking of paidBookings) {
    if (booking.booking_type === "daily" && isSameDay(parseISO(booking.event_date), date)) {
      return "blocked";
    }
  }
  
  // Check for hourly blocks or bookings (partial)
  for (const block of blocks) {
    if (block.block_type === "hourly" && isSameDay(parseISO(block.start_date), date)) {
      return "partial";
    }
  }
  
  for (const booking of paidBookings) {
    if (booking.booking_type === "hourly" && isSameDay(parseISO(booking.event_date), date)) {
      return "partial";
    }
  }
  
  return "available";
}
