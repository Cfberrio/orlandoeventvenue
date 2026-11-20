import { useState } from "react";
import { format, addMonths, addDays, addWeeks, isSameDay, getDay, parseISO } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarIcon, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { calculateEndDate, type BlockDuration } from "@/hooks/useAvailabilityBlocks";
import { useBookedDates, useAvailabilityBlocksForCalendar, useBlackoutDates, isDateFullyBooked, isTimeRangeAvailable } from "@/hooks/useBookedDates";
import { ADMIN_EVENT_TYPE_OPTIONS } from "@/lib/adminEventTypes";

interface InternalBookingWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type BookingType = "hourly" | "daily";

const TIME_SLOTS = [
  "08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", 
  "15:00", "16:00", "17:00", "18:00", "19:00", "20:00", "21:00", "22:00"
];

// Helper function to generate recurring dates for hourly bookings
const generateRecurringDates = (startDate: Date, duration: BlockDuration): Date[] => {
  const dates: Date[] = [startDate];
  
  if (duration === "1_day") {
    return dates;
  }
  
  const dayOfWeek = getDay(startDate);
  const endDate = calculateEndDate(startDate, duration);
  let currentDate = addWeeks(startDate, 1);
  
  // Generate all dates with the same day of week until endDate
  while (currentDate <= endDate) {
    if (getDay(currentDate) === dayOfWeek) {
      dates.push(new Date(currentDate));
    }
    currentDate = addDays(currentDate, 1);
  }
  
  return dates;
};

export function InternalBookingWizard({ open, onOpenChange }: InternalBookingWizardProps) {
  const queryClient = useQueryClient();
  const { data: bookedSlots = [] } = useBookedDates();
  const { data: availabilityBlocks = [] } = useAvailabilityBlocksForCalendar();
  const { data: blackoutDates = [] } = useBlackoutDates();
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Form state
  const [bookingType, setBookingType] = useState<BookingType>("daily");
  const [date, setDate] = useState<Date | undefined>(undefined);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [duration, setDuration] = useState<BlockDuration>("1_day");
  const [numberOfGuests, setNumberOfGuests] = useState(50);
  const [eventType, setEventType] = useState("");
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [notes, setNotes] = useState("");

  const resetForm = () => {
    setBookingType("daily");
    setDate(undefined);
    setStartTime("");
    setEndTime("");
    setDuration("1_day");
    setNumberOfGuests(50);
    setEventType("");
    setClientName("");
    setClientEmail("");
    setClientPhone("");
    setNotes("");
  };

  const handleClose = () => {
    resetForm();
    onOpenChange(false);
  };

  // Calculate end date based on duration
  const getEndDate = (): Date | undefined => {
    if (!date) return undefined;
    return calculateEndDate(date, duration);
  };

  const handleSubmit = async () => {
    if (!date) {
      toast.error("Please select a date");
      return;
    }
    if (!eventType) {
      toast.error("Please select an event type");
      return;
    }
    if (!clientName.trim()) {
      toast.error("Please enter client name");
      return;
    }
    if (!clientEmail.trim()) {
      toast.error("Please enter client email");
      return;
    }
    if (!clientPhone.trim()) {
      toast.error("Please enter client phone");
      return;
    }
    if (bookingType === "hourly" && (!startTime || !endTime)) {
      toast.error("Please select start and end times for hourly booking");
      return;
    }

    // Validate availability
    if (bookingType === "daily") {
      const isAvailable = !isDateFullyBooked(date, bookedSlots, availabilityBlocks, blackoutDates);
      if (!isAvailable) {
        toast.error("This date is not available for daily booking. There may be existing hourly or daily bookings.");
        return;
      }
    }

    if (bookingType === "hourly") {
      // For hourly bookings, check all recurring dates
      const recurringDates = generateRecurringDates(date, duration);
      
      for (const recurringDate of recurringDates) {
        const isAvailable = isTimeRangeAvailable(recurringDate, startTime, endTime, bookedSlots, availabilityBlocks, blackoutDates);
        if (!isAvailable) {
          toast.error(`This time slot is not available on ${format(recurringDate, "MM/dd/yyyy")}. Please choose different times or dates.`);
          return;
        }
      }
    }

    setIsSubmitting(true);

    try {
      const eventDate = format(date, "yyyy-MM-dd");
      const endDate = getEndDate();
      const endDateStr = endDate ? format(endDate, "yyyy-MM-dd") : eventDate;

      // For hourly bookings, force duration to 1 day
      const effectiveDuration = bookingType === "hourly" ? "1_day" : duration;
      const effectiveEndDate = bookingType === "hourly" ? eventDate : endDateStr;

      // E-16 / E-17 (86e40ach2): one server call locks the dates, re-checks
      // conflicts, and creates one booking + block per occurrence (a series
      // shares series_id), or nothing at all.
      const occurrenceDates =
        bookingType === "hourly" && duration !== "1_day"
          ? generateRecurringDates(date, duration).map((d) => format(d, "yyyy-MM-dd"))
          : [eventDate];
      const { data: created, error: createError } = await supabase.rpc("admin_create_blocking_booking" as never, {
        p: {
          kind: "internal",
          booking_type: bookingType,
          dates: occurrenceDates,
          end_date: bookingType === "daily" ? effectiveEndDate : null,
          start_time: bookingType === "hourly" ? startTime : null,
          end_time: bookingType === "hourly" ? endTime : null,
          number_of_guests: numberOfGuests,
          event_type: eventType,
          client_name: clientName,
          client_email: clientEmail,
          client_phone: clientPhone,
          notes: notes || null,
        },
      } as never);
      if (createError) throw createError;
      const bookingIds: string[] = ((created as { booking_ids?: string[] } | null)?.booking_ids) ?? [];

      // Follow-ups per booking; a failure here does not undo the bookings.
      for (const bookingId of bookingIds) {
        try {
          await supabase.functions.invoke("sync-ghl-calendar", {
            body: { booking_id: bookingId, skip_if_unchanged: false },
          });
        } catch (syncError) {
          console.error("Error syncing to GHL calendar:", syncError);
        }
      }

      // Invalidate queries
      queryClient.invalidateQueries({ queryKey: ["bookings"] });
      queryClient.invalidateQueries({ queryKey: ["availability-blocks"] });
      queryClient.invalidateQueries({ queryKey: ["booked-dates"] });

      // Success message
      let successMessage = "";
      if (bookingType === "hourly" && duration !== "1_day") {
        const recurringDates = generateRecurringDates(date, duration);
        successMessage = `Internal recurring booking created for ${recurringDates.length} occurrence(s) every ${format(date, "EEEE")} from ${format(date, "MM/dd")} to ${format(getEndDate()!, "MM/dd/yyyy")}`;
      } else if (bookingType === "daily" && effectiveDuration !== "1_day") {
        successMessage = `Internal booking created for ${format(date, "MM/dd")} - ${format(parseISO(effectiveEndDate), "MM/dd/yyyy")}`;
      } else {
        successMessage = `Internal booking created for ${format(date, "MM/dd/yyyy")}`;
      }
      
      toast.success(successMessage);
      handleClose();
    } catch (error) {
      console.error("Error creating internal booking:", error);
      toast.error("Failed to create internal booking", {
        description: (error as { message?: string })?.message,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[90vh] supports-[height:100dvh]:max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Internal Booking</DialogTitle>
          <DialogDescription>
            Block time for internal events or maintenance. This will not trigger GHL automations.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Booking Type */}
          <div className="space-y-2">
            <Label>Booking Type</Label>
            <RadioGroup
              value={bookingType}
              onValueChange={(v) => setBookingType(v as BookingType)}
              className="flex gap-4"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="daily" id="daily" />
                <Label htmlFor="daily" className="font-normal cursor-pointer">Full Day</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="hourly" id="hourly" />
                <Label htmlFor="hourly" className="font-normal cursor-pointer">Hourly</Label>
              </div>
            </RadioGroup>
          </div>

          {/* Date Selection */}
          <div className="space-y-2">
            <Label>Event Date</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !date && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {date ? format(date, "MM/dd/yyyy") : "Select date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={date}
                  onSelect={setDate}
                  disabled={(date) => date < new Date()}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>

          {/* Duration */}
          <div className="space-y-2">
            <Label>Duration</Label>
            <Select value={duration} onValueChange={(v) => setDuration(v as BlockDuration)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1_day">
                  {bookingType === "hourly" ? "Single Occurrence" : "1 Day"}
                </SelectItem>
                <SelectItem value="1_week">1 Week</SelectItem>
                <SelectItem value="1_month">1 Month</SelectItem>
                <SelectItem value="2_months">2 Months</SelectItem>
              </SelectContent>
            </Select>
            {date && duration !== "1_day" && (
              <p className="text-sm text-muted-foreground">
                {bookingType === "hourly" 
                  ? `Repeats every ${format(date, "EEEE")} from ${format(date, "MM/dd")} to ${format(getEndDate()!, "MM/dd/yyyy")}`
                  : `Blocks from ${format(date, "MM/dd")} to ${format(getEndDate()!, "MM/dd/yyyy")}`
                }
              </p>
            )}
          </div>

          {/* Time Selection (only for hourly) */}
          {bookingType === "hourly" && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Start Time</Label>
                <Input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  step={60}
                />
                <p className="text-xs text-muted-foreground">Type or pick any time (24h format)</p>
              </div>
              <div className="space-y-2">
                <Label>End Time</Label>
                <Input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  step={60}
                />
                <p className="text-xs text-muted-foreground">Must be after start time</p>
              </div>
            </div>
          )}

          {/* Event Type */}
          <div className="space-y-2">
            <Label>Event Type</Label>
            <Select value={eventType} onValueChange={setEventType}>
              <SelectTrigger>
                <SelectValue placeholder="Select event type" />
              </SelectTrigger>
              <SelectContent>
                {ADMIN_EVENT_TYPE_OPTIONS.map((type) => (
                  <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Number of Guests */}
          <div className="space-y-2">
            <Label>Number of Guests</Label>
            <Input
              type="number"
              min={1}
              value={numberOfGuests}
              onChange={(e) => setNumberOfGuests(parseInt(e.target.value) || 1)}
            />
          </div>

          {/* Client Info */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Client Name *</Label>
              <Input
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="Enter client name"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Email *</Label>
                <Input
                  type="email"
                  value={clientEmail}
                  onChange={(e) => setClientEmail(e.target.value)}
                  placeholder="client@example.com"
                />
              </div>
              <div className="space-y-2">
                <Label>Phone *</Label>
                <Input
                  value={clientPhone}
                  onChange={(e) => setClientPhone(e.target.value)}
                  placeholder="(555) 123-4567"
                />
              </div>
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Internal notes about this booking..."
              rows={3}
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-4 border-t">
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create Internal Booking
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
