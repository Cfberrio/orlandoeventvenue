import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { BookingFormData } from "@/pages/Book";
import { useState, useRef, useEffect } from "react";
import { formatPhoneNumber, isValidPhone } from "@/lib/utils";
import { ShieldCheck, Upload, CheckCircle2, Loader2 } from "lucide-react";
import { LICENSE_ACCEPT, uploadLicenseFile, validateLicenseFile } from "@/lib/licenseUpload";

type LicenseSide = "front" | "back";

const venueRules = [
  "Bar service available as a paid add-on. No outside alcohol or outside bartenders permitted: $250 fee",
  "No Drugs: $300 fee",
  "No Smoking: $300 cleaning fee",
  "No Pets (service animals with certification only): $100 cleaning fee",
  "Food & Beverage Compliance: $300 fee",
  "No Glitter / Confetti / Rice: $300 cleaning fee",
  "Setup & Breakdown Time: $200/hr overtime + $150 if not restored",
  "Maximum Occupancy: 90 Guests, $200 fee",
  "Decoration Rules: $200 damage fee",
  "Damage & Repair: Repair costs (min. $200)",
  "Chairs & Tables Reset: $150 fee",
];

const formSchema = z.object({
  fullName: z.string().trim().min(2, "Name must be at least 2 characters").max(100),
  email: z.string().trim().email("Invalid email address").max(255),
  phone: z.string().trim().refine(isValidPhone, {
    message: "Please enter a valid US phone number (10 digits)",
  }),
  company: z.string().max(100).optional(),
  agreeToRules: z.boolean().refine((val) => val === true, {
    message: "You must agree to the Venue Rules & Fee Schedule",
  }),
  agreeToSms: z.boolean().refine((val) => val === true, {
    message: "You must agree to receive SMS messages",
  }),
  beerWineService: z.boolean().default(false),
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
  const containerRef = useRef<HTMLDivElement>(null);
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
      beerWineService: data.beerWineService || false,
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

  // Initialize canvas size
  useEffect(() => {
    const resizeCanvas = () => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;

      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;

      // Set canvas internal size (scaled by device pixel ratio for crisp lines)
      canvas.width = rect.width * dpr;
      canvas.height = 200 * dpr;

      // Set canvas display size
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = '200px';

      // Scale context to match device pixel ratio
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.scale(dpr, dpr);
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
      }
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    return () => window.removeEventListener('resize', resizeCanvas);
  }, []);

  const getCoordinates = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    let clientX: number, clientY: number;

    if ('touches' in e) {
      // Touch event
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      // Mouse event
      clientX = e.clientX;
      clientY = e.clientY;
    }

    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  };

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    setIsDrawing(true);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { x, y } = getCoordinates(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { x, y } = getCoordinates(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    if (isDrawing && canvasRef.current) {
      const signature = canvasRef.current.toDataURL('image/png');
      form.setValue("signature", signature);
    }
    setIsDrawing(false);
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    
    // Clear with proper scaling
    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    form.setValue("signature", "");
  };

  // Files picked in this visit; paths already in `data` mean a previous visit uploaded them.
  const [licenseFiles, setLicenseFiles] = useState<Record<LicenseSide, File | null>>({ front: null, back: null });
  const [licenseErrors, setLicenseErrors] = useState<Record<LicenseSide, string | null>>({ front: null, back: null });
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const uploadedPath: Record<LicenseSide, string | undefined> = {
    front: data.licenseFrontPath,
    back: data.licenseBackPath,
  };

  const pickLicenseFile = (side: LicenseSide, file: File | undefined) => {
    if (!file) return;
    const err = validateLicenseFile(file);
    setLicenseErrors((prev) => ({ ...prev, [side]: err }));
    setLicenseFiles((prev) => ({ ...prev, [side]: err ? null : file }));
  };

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    const missing = (["front", "back"] as LicenseSide[]).filter((s) => !licenseFiles[s] && !uploadedPath[s]);
    if (missing.length) {
      setLicenseErrors((prev) => {
        const next = { ...prev };
        missing.forEach((s) => (next[s] = next[s] ?? `Please upload the ${s} of your driver's license.`));
        return next;
      });
      return;
    }

    setUploadError(null);
    setIsUploading(true);
    // Upload each pending side independently. A side that succeeds is saved right
    // away and its file cleared, so a retry only re-sends the side that failed.
    const pending = (["front", "back"] as LicenseSide[]).filter((s) => licenseFiles[s]);
    const results = await Promise.allSettled(pending.map((s) => uploadLicenseFile(licenseFiles[s]!, s)));
    const paths = { ...uploadedPath };
    const failures: string[] = [];
    results.forEach((r, i) => {
      const side = pending[i];
      if (r.status === "fulfilled") paths[side] = r.value;
      else failures.push(r.reason instanceof Error ? r.reason.message : "Upload failed. Please try again.");
    });
    const succeeded = pending.filter((_, i) => results[i].status === "fulfilled");
    if (succeeded.length) {
      setLicenseFiles((prev) => {
        const next = { ...prev };
        succeeded.forEach((s) => (next[s] = null));
        return next;
      });
    }
    updateData({ ...values, licenseFrontPath: paths.front, licenseBackPath: paths.back });
    setIsUploading(false);

    if (failures.length) {
      setUploadError(failures.join(" "));
      return;
    }
    onNext();
  };

  // Validate the license alongside the rest of the form so all errors show at once.
  const onInvalid = () => {
    setLicenseErrors((prev) => ({
      front: prev.front ?? (!licenseFiles.front && !uploadedPath.front ? "Please upload the front of your driver's license." : null),
      back: prev.back ?? (!licenseFiles.back && !uploadedPath.back ? "Please upload the back of your driver's license." : null),
    }));
  };

  const renderLicenseInput = (side: LicenseSide, label: string) => {
    const file = licenseFiles[side];
    const done = !file && !!uploadedPath[side];
    return (
      <div>
        <FormLabel htmlFor={`license-${side}`}>{label} *</FormLabel>
        <label
          htmlFor={`license-${side}`}
          className="mt-2 flex cursor-pointer items-center gap-3 rounded-lg border-2 border-dashed border-border bg-background p-4 hover:bg-muted/40"
        >
          {file || done ? (
            <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600" />
          ) : (
            <Upload className="h-5 w-5 shrink-0 text-muted-foreground" />
          )}
          <span className="min-w-0 truncate text-sm">
            {file ? file.name : done ? "Uploaded — click to replace" : "Choose a photo or PDF"}
          </span>
        </label>
        <input
          id={`license-${side}`}
          type="file"
          accept={LICENSE_ACCEPT}
          className="sr-only"
          onChange={(e) => pickLicenseFile(side, e.target.files?.[0])}
        />
        {licenseErrors[side] && (
          <p className="mt-2 text-sm font-medium text-destructive">{licenseErrors[side]}</p>
        )}
      </div>
    );
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit, onInvalid)} className="space-y-6">
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
                  <Input
                    type="tel"
                    placeholder="(407) 123-4567"
                    inputMode="numeric"
                    maxLength={14}
                    {...field}
                    onChange={(e) => field.onChange(formatPhoneNumber(e.target.value))}
                  />
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
                      href="/terms-of-use"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline hover:text-primary/80"
                    >
                      Terms of Use
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

          {/* Beer & Wine Service */}
          <div className="pt-4">
            <h3 className="text-lg font-semibold mb-2">Beer & Wine Service</h3>
            <p className="text-sm text-muted-foreground mb-3">
              Will your event include beer or wine?
            </p>
          </div>

          <FormField
            control={form.control}
            name="beerWineService"
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
                    Yes, we will be having beer and/or wine at our event.
                  </FormLabel>
                  <FormDescription className="text-xs text-muted-foreground">
                    Beer and wine must be served by Orlando Event Venue staff. You can select one of our production packages above, or our bartenders can be hired directly through us. We'll coordinate the details after your booking is confirmed.
                  </FormDescription>
                </div>
              </FormItem>
            )}
          />
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
              Draw your signature in the box below (use mouse or touch)
            </FormDescription>
            
            <div 
              ref={containerRef} 
              className="border-2 border-border rounded-lg overflow-hidden bg-background"
            >
              <canvas
                ref={canvasRef}
                className="w-full cursor-crosshair touch-none"
                style={{ height: '200px' }}
                onMouseDown={startDrawing}
                onMouseMove={draw}
                onMouseUp={stopDrawing}
                onMouseLeave={stopDrawing}
                onTouchStart={startDrawing}
                onTouchMove={draw}
                onTouchEnd={stopDrawing}
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

        <div className="space-y-4 pt-6">
          <div>
            <h3 className="text-lg font-semibold mb-2">Driver's License Verification</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Upload a clear photo or PDF of the front and back of the driver's license of the person signing this agreement.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {renderLicenseInput("front", "Front of License")}
            {renderLicenseInput("back", "Back of License")}
          </div>

          <div className="flex items-start gap-3 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-900 dark:border-green-900 dark:bg-green-950/40 dark:text-green-100">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" />
            <p className="leading-relaxed">
              <span className="font-semibold">Your information is safe with us.</span>{" "}
              Your license is stored in encrypted, private storage and is only used to verify the identity of the person responsible for this booking. It is never shared or sold, never shown publicly, and only authorized Orlando Event Venue management can view it. We automatically delete it 30 days after your event.
            </p>
          </div>

          {uploadError && <p className="text-sm font-medium text-destructive">{uploadError}</p>}
        </div>

        <div className="flex justify-between pt-4">
          <Button type="button" variant="outline" onClick={onBack} disabled={isUploading}>
            Back
          </Button>
          <Button type="submit" size="lg" disabled={isUploading}>
            {isUploading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Uploading...
              </>
            ) : (
              "Proceed to Payment"
            )}
          </Button>
        </div>
      </form>
    </Form>
  );
};

export default ContactPoliciesStep;
