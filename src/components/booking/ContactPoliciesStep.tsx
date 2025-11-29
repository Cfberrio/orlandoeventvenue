import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { BookingFormData } from "@/pages/Book";
import { useState, useRef } from "react";

const policyItems = [
  { id: "no-alcohol", label: "No Alcoholic Drinks — $250 violation fee" },
  { id: "no-drugs", label: "No Drugs — $300 violation fee" },
  { id: "no-smoking", label: "No Smoking — $300 cleaning fee" },
  { id: "no-pets", label: "No Pets (service animals exempt with certification) — $100 cleaning fee" },
  { id: "food-beverage", label: "Food & Beverage Compliance — $300 violation fee" },
  { id: "no-glitter", label: "No Glitter / Confetti / Rice (or similar) — $300 cleaning fee" },
  { id: "setup-breakdown", label: "Setup & Breakdown Time — $200/hr overtime + $150 if not restored" },
  { id: "max-occupancy", label: "Maximum Occupancy (≤ 90) — $200 violation fee" },
  { id: "decoration-rules", label: "Decoration Rules — $200 damage fee" },
  { id: "damage-repair", label: "Damage & Repair — Repair costs (min $200)" },
  { id: "chairs-tables", label: "Chairs & Tables Reset — $150 fee" },
];

const formSchema = z.object({
  fullName: z.string().trim().min(2, "Name must be at least 2 characters").max(100),
  email: z.string().trim().email("Invalid email address").max(255),
  phone: z.string().trim().min(10, "Phone number must be at least 10 digits").max(20),
  company: z.string().max(100).optional(),
  policies: z.record(z.boolean()).refine((policies) => {
    return policyItems.every((item) => policies[item.id] === true);
  }, "You must agree to all policies"),
  signature: z.string().min(2, "Signature is required"),
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

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      fullName: data.fullName || "",
      email: data.email || "",
      phone: data.phone || "",
      company: data.company || "",
      policies: data.policies || {},
      signature: data.signature || "",
    },
  });

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
            <h3 className="text-lg font-semibold mb-2">Venue Policies Agreement</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Please read and agree to all venue policies below. These are required to proceed.
            </p>
          </div>

          {policyItems.map((item) => (
            <FormField
              key={item.id}
              control={form.control}
              name={`policies.${item.id}`}
              render={({ field }) => (
                <FormItem className="flex flex-row items-start space-x-3 space-y-0 border rounded-lg p-3">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel className="text-sm font-normal cursor-pointer">
                      {item.label}
                    </FormLabel>
                  </div>
                </FormItem>
              )}
            />
          ))}
          {form.formState.errors.policies?.message && (
            <p className="text-sm font-medium text-destructive">
              {String(form.formState.errors.policies.message)}
            </p>
          )}
        </div>

        <div className="space-y-4 pt-6">
          <div>
            <h3 className="text-lg font-semibold mb-2">Signature *</h3>
            <FormDescription>
              Draw your signature in the box below
            </FormDescription>
          </div>
          
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
          
          <Button type="button" variant="outline" size="sm" onClick={clearSignature}>
            Clear Signature
          </Button>
          {form.formState.errors.signature?.message && (
            <p className="text-sm font-medium text-destructive">
              {String(form.formState.errors.signature.message)}
            </p>
          )}
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
