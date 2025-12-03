import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormDescription, FormMessage } from "@/components/ui/form";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { BookingFormData } from "@/pages/Book";

interface AddOnsStepProps {
  data: Partial<BookingFormData>;
  updateData: (data: Partial<BookingFormData>) => void;
  onNext: () => void;
  onBack: () => void;
}

const AddOnsStep = ({ data, updateData, onNext, onBack }: AddOnsStepProps) => {
  // Get booking time constraints
  const getTimeConstraints = () => {
    if (data.bookingType === "daily") {
      return { minHours: 4, maxHours: 12 };
    }
    // For hourly, max is the rental duration
    if (data.startTime && data.endTime) {
      const start = new Date(`2000-01-01T${data.startTime}`);
      const end = new Date(`2000-01-01T${data.endTime}`);
      const hours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
      return { minHours: 4, maxHours: hours, rentalStart: data.startTime, rentalEnd: data.endTime };
    }
    return { minHours: 4, maxHours: 12 };
  };

  const constraints = getTimeConstraints();

  const formSchema = z.object({
    package: z.enum(["none", "basic", "led", "workshop"]),
    packageStartTime: z.string(),
    packageEndTime: z.string(),
    setupBreakdown: z.boolean(),
    tablecloths: z.boolean(),
    tableclothQuantity: z.coerce.number().min(0).max(10, "Maximum 10 tablecloths"),
  }).refine((data) => {
    if (data.package === "none") return true;
    if (!data.packageStartTime || !data.packageEndTime) return false;
    
    const start = new Date(`2000-01-01T${data.packageStartTime}`);
    const end = new Date(`2000-01-01T${data.packageEndTime}`);
    const hours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
    
    return hours >= 4;
  }, {
    message: "Package time must be at least 4 hours",
    path: ["packageEndTime"],
  }).refine((data) => {
    if (data.package === "none") return true;
    if (!data.packageStartTime || !data.packageEndTime) return false;
    
    const start = new Date(`2000-01-01T${data.packageStartTime}`);
    const end = new Date(`2000-01-01T${data.packageEndTime}`);
    const hours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
    
    return hours <= constraints.maxHours;
  }, {
    message: `Package time cannot exceed ${constraints.maxHours} hours`,
    path: ["packageEndTime"],
  });

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      package: data.package || "none",
      packageStartTime: data.packageStartTime || "",
      packageEndTime: data.packageEndTime || "",
      setupBreakdown: data.setupBreakdown || false,
      tablecloths: data.tablecloths || false,
      tableclothQuantity: data.tableclothQuantity || 0,
    },
  });

  const tableclothsChecked = form.watch("tablecloths");
  const selectedPackage = form.watch("package");

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    updateData({
      ...values,
      packageStartTime: values.package === "none" ? "" : values.packageStartTime,
      packageEndTime: values.package === "none" ? "" : values.packageEndTime,
    });
    onNext();
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        <div>
          <h2 className="text-2xl font-bold mb-4">Add-Ons & Packages</h2>
          <p className="text-muted-foreground mb-6">
            Enhance your event with optional packages and services
          </p>
        </div>

        <FormField
          control={form.control}
          name="package"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-lg font-semibold">Production Packages</FormLabel>
              <FormDescription className="mb-4">
                Select one package (charged per hour)
              </FormDescription>
              <FormControl>
                <RadioGroup
                  onValueChange={field.onChange}
                  defaultValue={field.value}
                  className="space-y-3"
                >
                  <div className="flex items-start space-x-3 border rounded-lg p-4 hover:bg-accent/50 transition-colors">
                    <RadioGroupItem value="none" id="none" className="mt-1" />
                    <label htmlFor="none" className="flex-1 cursor-pointer">
                      <div className="font-semibold">No Package</div>
                      <div className="text-sm text-muted-foreground">Just the venue space</div>
                    </label>
                  </div>

                  <div className="flex items-start space-x-3 border rounded-lg p-4 hover:bg-accent/50 transition-colors">
                    <RadioGroupItem value="basic" id="basic" className="mt-1" />
                    <label htmlFor="basic" className="flex-1 cursor-pointer">
                      <div className="font-semibold">Basic Package — $79/hr</div>
                      <div className="text-sm text-muted-foreground mt-1">
                        Includes: AV System, Microphones, Speakers, Projectors, Tech Assistant
                      </div>
                    </label>
                  </div>

                  <div className="flex items-start space-x-3 border rounded-lg p-4 hover:bg-accent/50 transition-colors">
                    <RadioGroupItem value="led" id="led" className="mt-1" />
                    <label htmlFor="led" className="flex-1 cursor-pointer">
                      <div className="font-semibold">LED Package — $99/hr</div>
                      <div className="text-sm text-muted-foreground mt-1">
                        Includes Basic + Stage LED Wall (for presentations/immersive experiences)
                      </div>
                    </label>
                  </div>

                  <div className="flex items-start space-x-3 border rounded-lg p-4 hover:bg-accent/50 transition-colors">
                    <RadioGroupItem value="workshop" id="workshop" className="mt-1" />
                    <label htmlFor="workshop" className="flex-1 cursor-pointer">
                      <div className="font-semibold">Workshop Package — $149/hr</div>
                      <div className="text-sm text-muted-foreground mt-1">
                        Includes LED + Streaming Equipment + Streaming Tech (for streaming/recording/VC)
                      </div>
                    </label>
                  </div>
                </RadioGroup>
              </FormControl>
            </FormItem>
          )}
        />

        {selectedPackage !== "none" && (
          <div className="border rounded-lg p-4 bg-accent/20 space-y-4">
            <div>
              <FormLabel className="font-semibold text-base">Package Time</FormLabel>
              <FormDescription>
                {data.bookingType === "daily" 
                  ? "Select start and end time for the package (min 4 hours, max 12 hours)"
                  : `Select start and end time within your rental period (min 4 hours, max ${constraints.maxHours} hours)`
                }
              </FormDescription>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="packageStartTime"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Start Time</FormLabel>
                    <FormControl>
                      <Input type="time" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="packageEndTime"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>End Time</FormLabel>
                    <FormControl>
                      <Input type="time" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </div>
        )}

        <div className="space-y-4">
          <FormLabel className="text-lg font-semibold">Optional Services</FormLabel>
          <FormDescription className="mb-4">
            Additional flat-rate services
          </FormDescription>

          <FormField
            control={form.control}
            name="setupBreakdown"
            render={({ field }) => (
              <FormItem className="flex flex-row items-start space-x-3 space-y-0 border rounded-lg p-4">
                <FormControl>
                  <Checkbox
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
                <div className="flex-1">
                  <FormLabel className="font-semibold cursor-pointer">
                    Setup & Breakdown of Chairs/Tables — $100
                  </FormLabel>
                  <FormDescription>
                    We'll handle all furniture setup and breakdown for your event
                  </FormDescription>
                </div>
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="tablecloths"
            render={({ field }) => (
              <FormItem className="flex flex-row items-start space-x-3 space-y-0 border rounded-lg p-4">
                <FormControl>
                  <Checkbox
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
                <div className="flex-1">
                  <FormLabel className="font-semibold cursor-pointer">
                    Tablecloth Rental — $5 each + $25 cleaning fee
                  </FormLabel>
                  <FormDescription>
                    Professional tablecloths for your event (max 10)
                  </FormDescription>
                </div>
              </FormItem>
            )}
          />

          {tableclothsChecked && (
            <FormField
              control={form.control}
              name="tableclothQuantity"
              render={({ field }) => (
                <FormItem className="ml-9">
                  <FormLabel>Number of Tablecloths (max 10)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={1}
                      max={10}
                      placeholder="Enter quantity"
                      className="max-w-xs"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
        </div>

        <div className="flex justify-between pt-4">
          <Button type="button" variant="outline" onClick={onBack}>
            Back
          </Button>
          <Button type="submit" size="lg">
            Continue to Summary
          </Button>
        </div>
      </form>
    </Form>
  );
};

export default AddOnsStep;
