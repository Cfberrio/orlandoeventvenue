import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format, isSameDay, parseISO, isWithinInterval } from "date-fns";

export interface BookedSlot {
  event_date: string;
  booking_type: "hourly" | "daily";
  start_time: string | null;
  end_time: string | null;
}

export interface AvailabilityBlock {
  id: string;
  block_type: "hourly" | "daily";
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
}

export interface BlackoutDate {
  start_date: string;
  end_date: string;
}

// Fetch paid bookings
export const useBookedDates = () => {
  return useQuery({
    queryKey: ["booked-dates"],
    queryFn: async (): Promise<BookedSlot[]> => {
      const today = format(new Date(), "yyyy-MM-dd");
      
      // Only fetch bookings that have been paid (deposit_paid or fully_paid) or invoiced (for internal)
      const { data, error } = await supabase
        .from("bookings")
        .select("event_date, booking_type, start_time, end_time")
        .in("payment_status", ["deposit_paid", "fully_paid", "invoiced"])
        .gte("event_date", today);

      if (error) {
        console.error("Error fetching booked dates:", error);
        throw error;
      }

      return (data || []) as BookedSlot[];
    },
    staleTime: 1000 * 60 * 5,
  });
};

// Fetch availability blocks
export const useAvailabilityBlocksForCalendar = () => {
  return useQuery({
    queryKey: ["availability-blocks-calendar"],
    queryFn: async (): Promise<AvailabilityBlock[]> => {
      const today = format(new Date(), "yyyy-MM-dd");
      
      const { data, error } = await supabase
        .from("availability_blocks")
        .select("id, block_type, start_date, end_date, start_time, end_time")
        .gte("end_date", today);

      if (error) {
        console.error("Error fetching availability blocks:", error);
        throw error;
      }

      return (data || []) as AvailabilityBlock[];
    },
    staleTime: 1000 * 60 * 5,
  });
};

// Fetch blackout dates
export const useBlackoutDates = () => {
  return useQuery({
    queryKey: ["blackout-dates"],
    queryFn: async (): Promise<BlackoutDate[]> => {
      const today = format(new Date(), "yyyy-MM-dd");
      
      const { data, error } = await supabase
        .from("blackout_dates")
        .select("start_date, end_date")
        .gte("end_date", today);

      if (error) {
        console.error("Error fetching blackout dates:", error);
        throw error;
      }

      return (data || []) as BlackoutDate[];
    },
    staleTime: 1000 * 60 * 5,
  });
};

// Helper: Convert time string to minutes
const toMinutes = (time: string): number => {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
};

// Check if date is within a block's date range
const isDateInBlockRange = (date: Date, block: AvailabilityBlock): boolean => {
  const startDate = parseISO(block.start_date);
  const endDate = parseISO(block.end_date);
  return isWithinInterval(date, { start: startDate, end: endDate });
};

// Check if a date is in blackout period
const isDateBlackedOut = (date: Date, blackoutDates: BlackoutDate[]): boolean => {
  return blackoutDates.some((blackout) => {
    const start = parseISO(blackout.start_date);
    const end = parseISO(blackout.end_date);
    return isWithinInterval(date, { start, end });
  });
};

/**
 * Check if a date is fully blocked for DAILY booking
 * A date is unavailable for daily if:
 * - Any daily availability_block overlaps that date
 * - Any PAID booking exists on that date (daily or hourly)
 * - Any hourly availability_block exists on that date
 * - The date is in blackout_dates
 */
export const isDateFullyBooked = (
  date: Date,
  bookedSlots: BookedSlot[],
  blocks: AvailabilityBlock[] = [],
  blackoutDates: BlackoutDate[] = []
): boolean => {
  // Check blackout dates
  if (isDateBlackedOut(date, blackoutDates)) {
    return true;
  }

  // Check daily blocks
  if (blocks.some((b) => b.block_type === "daily" && isDateInBlockRange(date, b))) {
    return true;
  }

  // Check hourly blocks (any hourly block on this date blocks daily booking)
  if (blocks.some((b) => b.block_type === "hourly" && isSameDay(parseISO(b.start_date), date))) {
    return true;
  }

  // Check any booking on this date
  if (bookedSlots.some((slot) => isSameDay(parseISO(slot.event_date), date))) {
    return true;
  }

  return false;
};

/**
 * Get booked time ranges for a specific date (for hourly bookings)
 */
export const getBookedTimesForDate = (
  date: Date,
  bookedSlots: BookedSlot[],
  blocks: AvailabilityBlock[] = []
): { start: string; end: string }[] => {
  const times: { start: string; end: string }[] = [];

  // Add times from hourly bookings
  bookedSlots
    .filter(
      (slot) =>
        slot.booking_type === "hourly" &&
        isSameDay(parseISO(slot.event_date), date) &&
        slot.start_time &&
        slot.end_time
    )
    .forEach((slot) => {
      times.push({ start: slot.start_time!, end: slot.end_time! });
    });

  // Add times from hourly blocks
  blocks
    .filter(
      (block) =>
        block.block_type === "hourly" &&
        isSameDay(parseISO(block.start_date), date) &&
        block.start_time &&
        block.end_time
    )
    .forEach((block) => {
      times.push({ start: block.start_time!, end: block.end_time! });
    });

  return times;
};

/**
 * Check if a time range is available for HOURLY booking
 * A date/time is unavailable for hourly if:
 * - Any daily availability_block overlaps that date
 * - Any PAID daily booking exists on that date
 * - Any hourly availability_block overlaps the requested time
 * - Any PAID hourly booking overlaps the requested time
 * - The date is in blackout_dates
 */
export const isTimeRangeAvailable = (
  date: Date,
  startTime: string,
  endTime: string,
  bookedSlots: BookedSlot[],
  blocks: AvailabilityBlock[] = [],
  blackoutDates: BlackoutDate[] = []
): boolean => {
  // Check blackout dates
  if (isDateBlackedOut(date, blackoutDates)) {
    return false;
  }

  // Check daily blocks (any daily block on this date blocks all times)
  if (blocks.some((b) => b.block_type === "daily" && isDateInBlockRange(date, b))) {
    return false;
  }

  // Check daily bookings (block all times on that date)
  if (bookedSlots.some((slot) => slot.booking_type === "daily" && isSameDay(parseISO(slot.event_date), date))) {
    return false;
  }

  const newStart = toMinutes(startTime);
  const newEnd = toMinutes(endTime);

  // Check hourly blocks for time overlap
  for (const block of blocks) {
    if (
      block.block_type === "hourly" &&
      isSameDay(parseISO(block.start_date), date) &&
      block.start_time &&
      block.end_time
    ) {
      const blockStart = toMinutes(block.start_time);
      const blockEnd = toMinutes(block.end_time);
      // Overlap: new_start < existing_end AND new_end > existing_start
      if (newStart < blockEnd && newEnd > blockStart) {
        return false;
      }
    }
  }

  // Check hourly bookings for time overlap
  for (const slot of bookedSlots) {
    if (
      slot.booking_type === "hourly" &&
      isSameDay(parseISO(slot.event_date), date) &&
      slot.start_time &&
      slot.end_time
    ) {
      const slotStart = toMinutes(slot.start_time);
      const slotEnd = toMinutes(slot.end_time);
      if (newStart < slotEnd && newEnd > slotStart) {
        return false;
      }
    }
  }

  return true;
};

/**
 * Get the availability status for a date (for calendar display)
 */
export const getDateAvailabilityStatus = (
  date: Date,
  bookedSlots: BookedSlot[],
  blocks: AvailabilityBlock[] = [],
  blackoutDates: BlackoutDate[] = []
): "available" | "partial" | "blocked" => {
  // Check blackout dates
  if (isDateBlackedOut(date, blackoutDates)) {
    return "blocked";
  }

  // Check daily blocks
  if (blocks.some((b) => b.block_type === "daily" && isDateInBlockRange(date, b))) {
    return "blocked";
  }

  // Check daily bookings
  if (bookedSlots.some((slot) => slot.booking_type === "daily" && isSameDay(parseISO(slot.event_date), date))) {
    return "blocked";
  }

  // Check for hourly blocks or bookings (partial)
  const hasHourlyBlock = blocks.some(
    (b) => b.block_type === "hourly" && isSameDay(parseISO(b.start_date), date)
  );
  const hasHourlyBooking = bookedSlots.some(
    (slot) => slot.booking_type === "hourly" && isSameDay(parseISO(slot.event_date), date)
  );

  if (hasHourlyBlock || hasHourlyBooking) {
    return "partial";
  }

  return "available";
};
