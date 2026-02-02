import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BookingFormData } from "@/pages/Book";

const formSchema = z.object({
  numberOfGuests: z.coerce
    .number()
    .min(1, "At least 1 guest required")
    .max(90, "Maximum capacity is 90 guests"),
  eventType: z.string().min(1, "Please select an event type"),
  eventTypeOther: z.string().optional(),
  notes: z.string()
    .min(10, "Please tell us more about how you'll use the venue (minimum 10 characters)")
    .max(1000, "Notes must be less than 1000 characters"),
});

interface GuestsEventStepProps {
  data: Partial<BookingFormData>;
  updateData: (data: Partial<BookingFormData>) => void;
  onNext: () => void;
  onBack: () => void;
}

const GuestsEventStep = ({ data, updateData, onNext, onBack }: GuestsEventStepProps) => {
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      numberOfGuests: data.numberOfGuests || 1,
      eventType: data.eventType || "",
      eventTypeOther: data.eventTypeOther || "",
      notes: data.notes || "",
    },
  });

  const eventType = form.watch("eventType");

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    updateData(values);
    onNext();
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold mb-4">Event Details</h2>
          <p className="text-muted-foreground mb-6">
            Tell us about your event and guest count
          </p>
        </div>

        <FormField
          control={form.control}
          name="numberOfGuests"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-base font-semibold">Number of Guests</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  min={1}
                  max={90}
                  placeholder="Enter number of guests"
                  {...field}
                />
              </FormControl>
              <FormDescription>
                Maximum capacity: 90 guests
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="eventType"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-base font-semibold">Event Type</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select event type" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent className="bg-background">
                  <SelectItem value="birthday-party">Birthday Party (adult or kids)</SelectItem>
                  <SelectItem value="baby-shower">Baby Shower</SelectItem>
                  <SelectItem value="bridal-shower">Bridal Shower</SelectItem>
                  <SelectItem value="wedding-reception">Wedding Reception</SelectItem>
                  <SelectItem value="graduation-party">Graduation Party</SelectItem>
                  <SelectItem value="corporate-meeting">Corporate Meeting / Team Meeting</SelectItem>
                  <SelectItem value="training-seminar">Training / Seminar</SelectItem>
                  <SelectItem value="workshop-class">Workshop / Class (fitness, cooking, education, etc.)</SelectItem>
                  <SelectItem value="networking-mixer">Networking Mixer / Meetup</SelectItem>
                  <SelectItem value="celebration-of-life">Celebration of Life / Memorial Reception</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        {eventType === "other" && (
          <FormField
            control={form.control}
            name="eventTypeOther"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base font-semibold">Please specify event type</FormLabel>
                <FormControl>
                  <Input placeholder="Enter your event type" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-base font-semibold">
                🎯 Tell Us About Your Event! <span className="text-red-600">*</span>
              </FormLabel>
              <FormControl>
                <Textarea
                  placeholder="What will you be using the venue for? Tell us about your event plans, activities, setup needs, or any special requests..."
                  className="min-h-[120px]"
                  {...field}
                />
              </FormControl>
              <FormDescription>
                Please describe how you'll use the space • {field.value?.length || 0} / 1000 characters
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex justify-between pt-4">
          <Button type="button" variant="outline" onClick={onBack}>
            Back
          </Button>
          <Button type="submit" size="lg">
            Continue to Add-Ons
          </Button>
        </div>
      </form>
    </Form>
  );
};

export default GuestsEventStep;
