import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { CalendarIcon, AlertCircle } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { BookingFormData } from "@/pages/Book";
import { useBookedDates, isDateFullyBooked, isTimeRangeAvailable } from "@/hooks/useBookedDates";
import { useEffect, useState } from "react";
import { toast } from "sonner";

const formSchema = z.object({
  bookingType: z.enum(["hourly", "daily"]),
  date: z.date({ required_error: "Please select a date" }),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
}).refine((data) => {
  if (data.bookingType === "hourly") {
    if (!data.startTime || !data.endTime) return false;
    
    const start = new Date(`2000-01-01T${data.startTime}`);
    const end = new Date(`2000-01-01T${data.endTime}`);
    const diffHours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
    
    return diffHours >= 4;
  }
  return true;
}, {
  message: "Hourly bookings must be at least 4 hours",
  path: ["endTime"],
});

interface BookingTypeStepProps {
  data: Partial<BookingFormData>;
  updateData: (data: Partial<BookingFormData>) => void;
  onNext: () => void;
}

const BookingTypeStep = ({ data, updateData, onNext }: BookingTypeStepProps) => {
  const { data: bookedSlots = [], isLoading: isLoadingDates } = useBookedDates();
  const [timeConflict, setTimeConflict] = useState(false);
  
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      bookingType: data.bookingType || "hourly",
      date: data.date,
      startTime: data.startTime || "09:00",
      endTime: data.endTime || "13:00",
    },
  });

  const bookingType = form.watch("bookingType");
  const selectedDate = form.watch("date");
  const startTime = form.watch("startTime");
  const endTime = form.watch("endTime");

  // Check time availability when date or times change (for hourly bookings)
  useEffect(() => {
    if (bookingType === "hourly" && selectedDate && startTime && endTime) {
      const isAvailable = isTimeRangeAvailable(selectedDate, startTime, endTime, bookedSlots);
      setTimeConflict(!isAvailable);
    } else {
      setTimeConflict(false);
    }
  }, [selectedDate, startTime, endTime, bookingType, bookedSlots]);

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    // For hourly bookings, check time availability before proceeding
    if (values.bookingType === "hourly" && values.date && values.startTime && values.endTime) {
      if (!isTimeRangeAvailable(values.date, values.startTime, values.endTime, bookedSlots)) {
        toast.error("Selected time range conflicts with an existing booking. Please choose different times.");
        return;
      }
    }
    
    updateData(values);
    onNext();
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold mb-4">Select Booking Type</h2>
          <p className="text-muted-foreground mb-6">
            Choose between hourly or daily rental options
          </p>
        </div>

        <FormField
          control={form.control}
          name="bookingType"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-base font-semibold">Booking Type</FormLabel>
              <FormControl>
                <RadioGroup
                  onValueChange={field.onChange}
                  defaultValue={field.value}
                  className="flex flex-col space-y-3"
                >
                  <div className="flex items-center space-x-3 border rounded-lg p-4 hover:bg-accent/50 transition-colors">
                    <RadioGroupItem value="hourly" id="hourly" />
                    <label
                      htmlFor="hourly"
                      className="flex-1 cursor-pointer"
                    >
                      <div className="font-semibold">Hourly Rental</div>
                      <div className="text-sm text-muted-foreground">
                        $140/hour (minimum 4 hours)
                      </div>
                    </label>
                  </div>
                  <div className="flex items-center space-x-3 border rounded-lg p-4 hover:bg-accent/50 transition-colors">
                    <RadioGroupItem value="daily" id="daily" />
                    <label
                      htmlFor="daily"
                      className="flex-1 cursor-pointer"
                    >
                      <div className="font-semibold">Daily Rental (24 hours)</div>
                      <div className="text-sm text-muted-foreground">
                        $899 for full day
                      </div>
                    </label>
                  </div>
                </RadioGroup>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="date"
          render={({ field }) => (
            <FormItem className="flex flex-col">
              <FormLabel className="text-base font-semibold">Event Date</FormLabel>
              <Popover>
                <PopoverTrigger asChild>
                  <FormControl>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full pl-3 text-left font-normal",
                        !field.value && "text-muted-foreground"
                      )}
                    >
                      {field.value ? (
                        format(field.value, "PPP")
                      ) : (
                        <span>Pick a date</span>
                      )}
                      <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                    </Button>
                  </FormControl>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={field.value}
                    onSelect={field.onChange}
                    disabled={(date) => {
                      // Disable past dates
                      if (date < new Date(new Date().setHours(0, 0, 0, 0))) {
                        return true;
                      }
                      // Disable dates with daily bookings (fully booked)
                      return isDateFullyBooked(date, bookedSlots);
                    }}
                    initialFocus
                    className="pointer-events-auto"
                  />
                  {isLoadingDates && (
                    <p className="text-xs text-muted-foreground p-2">Loading availability...</p>
                  )}
                </PopoverContent>
              </Popover>
              <FormMessage />
            </FormItem>
          )}
        />

        {bookingType === "hourly" && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="startTime"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base font-semibold">Start Time</FormLabel>
                    <FormControl>
                      <Input type="time" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="endTime"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base font-semibold">End Time</FormLabel>
                    <FormControl>
                      <Input type="time" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          
            {timeConflict && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                <p className="text-sm">
                  This time range conflicts with an existing booking. Please select different times.
                </p>
              </div>
            )}
          </>
        )}

        <div className="flex justify-end pt-4">
          <Button type="submit" size="lg" disabled={timeConflict}>
            Continue to Guests & Event
          </Button>
        </div>
      </form>
    </Form>
  );
};

export default BookingTypeStep;
