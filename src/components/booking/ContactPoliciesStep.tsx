import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { BookingFormData } from "@/pages/Book";
import { useState, useRef, useEffect } from "react";

const venueRules = [
  "No Alcoholic Drinks (only beer & wine allowed) — $250 fee",
  "No Drugs — $300 fee",
  "No Smoking — $300 cleaning fee",
  "No Pets (service animals with certification only) — $100 cleaning fee",
  "Food & Beverage Compliance — $300 fee",
  "No Glitter / Confetti / Rice — $300 cleaning fee",
  "Setup & Breakdown Time — $200/hr overtime + $150 if not restored",
  "Maximum Occupancy: 90 Guests — $200 fee",
  "Decoration Rules — $200 damage fee",
  "Damage & Repair — Repair costs (min. $200)",
  "Chairs & Tables Reset — $150 fee",
];

const formSchema = z.object({
  fullName: z.string().trim().min(2, "Name must be at least 2 characters").max(100),
  email: z.string().trim().email("Invalid email address").max(255),
  phone: z.string().trim().min(10, "Phone number must be at least 10 digits").max(20),
  company: z.string().max(100).optional(),
  agreeToRules: z.boolean().refine((val) => val === true, {
    message: "You must agree to the Venue Rules & Fee Schedule",
  }),
  agreeToSms: z.boolean().refine((val) => val === true, {
    message: "You must agree to receive SMS messages",
  }),
  initials: z.string().trim().min(2, "Initials must be at least 2 characters").max(4, "Initials must be 4 characters or less"),
  signerName: z.string().trim().min(2, "Name is required"),
  signature: z.string().min(2, "Signature is required"),
  signatureDate: z.string(),
});

interface ContactPoliciesStepProps {
  data: Partial<BookingFormData>;
  updateData: (data: Partial<BookingFormData>) => void;
  onNext: () => void;
  onBack: () => void;
}

const ContactPoliciesStep = ({ data, updateData, onNext, onBack }: ContactPoliciesStepProps) => {
  const [isDrawing, setIsDrawing] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const currentDate = new Date().toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      fullName: data.fullName || "",
      email: data.email || "",
      phone: data.phone || "",
      company: data.company || "",
      agreeToRules: data.agreeToRules || false,
      agreeToSms: data.agreeToSms || false,
      initials: data.initials || "",
      signerName: data.signerName || data.fullName || "",
      signature: data.signature || "",
      signatureDate: currentDate,
    },
  });

  // Auto-fill signer name when full name changes
  useEffect(() => {
    const subscription = form.watch((value, { name }) => {
      if (name === "fullName" && value.fullName) {
        form.setValue("signerName", value.fullName);
      }
    });
    return () => subscription.unsubscribe();
  }, [form]);

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement>) => {
    setIsDrawing(true);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.beginPath();
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.stroke();
  };

  const stopDrawing = () => {
    if (isDrawing && canvasRef.current) {
      const signature = canvasRef.current.toDataURL();
      form.setValue("signature", signature);
    }
    setIsDrawing(false);
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    form.setValue("signature", "");
  };

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    updateData(values);
    onNext();
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold mb-4">Contact Information & Policies</h2>
          <p className="text-muted-foreground mb-6">
            Provide your contact details and agree to our venue policies
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="fullName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Full Name *</FormLabel>
                <FormControl>
                  <Input placeholder="John Doe" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email *</FormLabel>
                <FormControl>
                  <Input type="email" placeholder="john@example.com" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="phone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Phone *</FormLabel>
                <FormControl>
                  <Input type="tel" placeholder="(555) 123-4567" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="company"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Company/Organization (Optional)</FormLabel>
                <FormControl>
                  <Input placeholder="Company Name" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="space-y-4 pt-6">
          <div>
            <h3 className="text-lg font-semibold mb-2">Venue Rules & Fee Schedule (Required)</h3>
            <p className="text-sm text-muted-foreground mb-3">
              Please review all venue rules before proceeding
            </p>
          </div>

          <ScrollArea className="h-[250px] w-full border rounded-lg p-4 bg-muted/30">
            <ul className="space-y-2">
              {venueRules.map((rule, index) => (
                <li key={index} className="text-sm text-foreground flex items-start">
                  <span className="mr-2 text-primary font-medium">•</span>
                  <span>{rule}</span>
                </li>
              ))}
            </ul>
          </ScrollArea>

          <FormField
            control={form.control}
            name="agreeToRules"
            render={({ field }) => (
              <FormItem className="flex flex-row items-start space-x-3 space-y-0 border rounded-lg p-4 bg-background">
                <FormControl>
                  <Checkbox
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
                <div className="space-y-1 leading-none">
                  <FormLabel className="text-sm font-medium cursor-pointer">
                    I have read and agree to the Venue Rules & Fee Schedule for this booking. *
                  </FormLabel>
                </div>
              </FormItem>
            )}
          />
          <FormMessage>
            {form.formState.errors.agreeToRules?.message}
          </FormMessage>

          <FormField
            control={form.control}
            name="agreeToSms"
            render={({ field }) => (
              <FormItem className="flex flex-row items-start space-x-3 space-y-0 border rounded-lg p-4 bg-background">
                <FormControl>
                  <Checkbox
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
                <div className="space-y-1 leading-none">
                  <FormLabel className="text-sm font-normal cursor-pointer">
                    I agree to receive text messages from Orlando Event Venue related to my booking, including confirmations, reminders, and important updates. Message and data rates may apply. Reply STOP to opt out, HELP for help. See our{" "}
                    <a
                      href="/sms-terms"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline hover:text-primary/80"
                    >
                      SMS Terms
                    </a>
                    {" "}and{" "}
                    <a
                      href="/privacy-policy"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline hover:text-primary/80"
                    >
                      Privacy Policy
                    </a>
                    . *
                  </FormLabel>
                </div>
              </FormItem>
            )}
          />
          <FormMessage>
            {form.formState.errors.agreeToSms?.message}
          </FormMessage>
        </div>

        <div className="space-y-4 pt-6">
          <div>
            <h3 className="text-lg font-semibold mb-2">Initials & Signature</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Confirm your understanding by providing your initials and signature
            </p>
          </div>

          <FormField
            control={form.control}
            name="initials"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Initials (to confirm you understand these rules) *</FormLabel>
                <FormControl>
                  <Input 
                    placeholder="e.g., JD" 
                    maxLength={4}
                    className="w-32 uppercase"
                    {...field} 
                    onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                  />
                </FormControl>
                <FormDescription>2-4 characters</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="signerName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name *</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="signatureDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Date</FormLabel>
                  <FormControl>
                    <Input {...field} readOnly className="bg-muted" />
                  </FormControl>
                </FormItem>
              )}
            />
          </div>

          <div>
            <FormLabel>Signature *</FormLabel>
            <FormDescription className="mb-2">
              Draw your signature in the box below
            </FormDescription>
            
            <div className="border-2 border-border rounded-lg overflow-hidden">
              <canvas
                ref={canvasRef}
                width={600}
                height={200}
                className="w-full bg-background cursor-crosshair touch-none"
                onMouseDown={startDrawing}
                onMouseMove={draw}
                onMouseUp={stopDrawing}
                onMouseLeave={stopDrawing}
              />
            </div>
            
            <Button type="button" variant="outline" size="sm" onClick={clearSignature} className="mt-2">
              Clear Signature
            </Button>
            {form.formState.errors.signature?.message && (
              <p className="text-sm font-medium text-destructive mt-2">
                {String(form.formState.errors.signature.message)}
              </p>
            )}

            <p className="text-xs text-muted-foreground mt-4 leading-relaxed">
              By initialing and signing, I agree to the Orlando Event Venue Terms & Conditions and Venue Rules & Fee Schedule for this booking.
            </p>
          </div>
        </div>

        <div className="flex justify-between pt-4">
          <Button type="button" variant="outline" onClick={onBack}>
            Back
          </Button>
          <Button type="submit" size="lg">
            Proceed to Payment
          </Button>
        </div>
      </form>
    </Form>
  );
};

export default ContactPoliciesStep;
