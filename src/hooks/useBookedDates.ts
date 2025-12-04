import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format, isSameDay, parseISO } from "date-fns";

interface BookedSlot {
  event_date: string;
  booking_type: "hourly" | "daily";
  start_time: string | null;
  end_time: string | null;
}

export const useBookedDates = () => {
  return useQuery({
    queryKey: ["booked-dates"],
    queryFn: async (): Promise<BookedSlot[]> => {
      const today = format(new Date(), "yyyy-MM-dd");
      
      // Only fetch bookings that have been paid (deposit_paid or fully_paid)
      const { data, error } = await supabase
        .from("bookings")
        .select("event_date, booking_type, start_time, end_time")
        .in("payment_status", ["deposit_paid", "fully_paid"])
        .gte("event_date", today);

      if (error) {
        console.error("Error fetching booked dates:", error);
        throw error;
      }

      return (data || []) as BookedSlot[];
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
};

// Check if a specific date is fully booked (has a daily booking)
export const isDateFullyBooked = (date: Date, bookedSlots: BookedSlot[]): boolean => {
  return bookedSlots.some(
    (slot) =>
      slot.booking_type === "daily" &&
      isSameDay(parseISO(slot.event_date), date)
  );
};

// Get booked time ranges for a specific date (for hourly bookings)
export const getBookedTimesForDate = (
  date: Date,
  bookedSlots: BookedSlot[]
): { start: string; end: string }[] => {
  return bookedSlots
    .filter(
      (slot) =>
        isSameDay(parseISO(slot.event_date), date) &&
        slot.start_time &&
        slot.end_time
    )
    .map((slot) => ({
      start: slot.start_time!,
      end: slot.end_time!,
    }));
};

// Check if a time range overlaps with any booked slots
export const isTimeRangeAvailable = (
  date: Date,
  startTime: string,
  endTime: string,
  bookedSlots: BookedSlot[]
): boolean => {
  // If there's a daily booking, no time is available
  if (isDateFullyBooked(date, bookedSlots)) {
    return false;
  }

  const bookedTimes = getBookedTimesForDate(date, bookedSlots);
  
  // Convert time strings to minutes for comparison
  const toMinutes = (time: string) => {
    const [hours, minutes] = time.split(":").map(Number);
    return hours * 60 + minutes;
  };

  const newStart = toMinutes(startTime);
  const newEnd = toMinutes(endTime);

  // Check for overlaps
  return !bookedTimes.some((booked) => {
    const bookedStart = toMinutes(booked.start);
    const bookedEnd = toMinutes(booked.end);
    
    // Overlap exists if new booking starts before existing ends AND new booking ends after existing starts
    return newStart < bookedEnd && newEnd > bookedStart;
  });
};
