import { useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { Loader2, Send } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

const PACKAGE_RATES: Record<string, number> = {
  none: 0,
  basic: 79,
  led: 99,
  workshop: 149,
};

const PACKAGE_LABELS: Record<string, string> = {
  none: "No Package",
  basic: "Basic Package",
  led: "LED Package",
  workshop: "Workshop Package",
};

const SETUP_BREAKDOWN_COST = 100;
const TABLECLOTH_UNIT_COST = 5;
const TABLECLOTH_CLEANING_FEE = 25;
const MAX_TABLECLOTHS = 10;
const MIN_PACKAGE_HOURS = 4;

interface CreateAddonInvoiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bookingId: string;
  customerEmail: string;
  customerName: string;
  eventDate: string;
  reservationNumber: string;
  onInvoiceCreated: () => void;
}

export default function CreateAddonInvoiceDialog({
  open,
  onOpenChange,
  bookingId,
  customerEmail,
  customerName,
  eventDate,
  reservationNumber,
  onInvoiceCreated,
}: CreateAddonInvoiceDialogProps) {
  const [selectedPackage, setSelectedPackage] = useState("none");
  const [packageStartTime, setPackageStartTime] = useState("");
  const [packageEndTime, setPackageEndTime] = useState("");
  const [setupBreakdown, setSetupBreakdown] = useState(false);
  const [tablecloths, setTablecloths] = useState(false);
  const [tableclothQuantity, setTableclothQuantity] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  const packageHours = useMemo(() => {
    if (selectedPackage === "none" || !packageStartTime || !packageEndTime) return 0;
    const start = new Date(`2000-01-01T${packageStartTime}`);
    const end = new Date(`2000-01-01T${packageEndTime}`);
    const hours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
    return hours > 0 ? hours : 0;
  }, [selectedPackage, packageStartTime, packageEndTime]);

  const packageCost = useMemo(
    () => (PACKAGE_RATES[selectedPackage] || 0) * packageHours,
    [selectedPackage, packageHours]
  );

  const optionalServicesCost = useMemo(() => {
    let cost = 0;
    if (setupBreakdown) cost += SETUP_BREAKDOWN_COST;
    if (tablecloths && tableclothQuantity > 0) {
      cost += tableclothQuantity * TABLECLOTH_UNIT_COST + TABLECLOTH_CLEANING_FEE;
    }
    return cost;
  }, [setupBreakdown, tablecloths, tableclothQuantity]);

  const totalAmount = packageCost + optionalServicesCost;

  const validationError = useMemo(() => {
    if (selectedPackage === "none" && !setupBreakdown && !tablecloths) {
      return "Select at least one package or service";
    }
    if (selectedPackage !== "none" && packageHours < MIN_PACKAGE_HOURS) {
      return `Package time must be at least ${MIN_PACKAGE_HOURS} hours`;
    }
    if (totalAmount <= 0) {
      return "Total amount must be greater than $0";
    }
    return null;
  }, [selectedPackage, setupBreakdown, tablecloths, packageHours, totalAmount]);

  const resetForm = () => {
    setSelectedPackage("none");
    setPackageStartTime("");
    setPackageEndTime("");
    setSetupBreakdown(false);
    setTablecloths(false);
    setTableclothQuantity(1);
  };

  const handleSubmit = async () => {
    if (validationError) {
      toast({ title: validationError, variant: "destructive" });
      return;
    }

    setSubmitting(true);

    try {
      const invoiceData = {
        booking_id: bookingId,
        package: selectedPackage,
        package_start_time: selectedPackage !== "none" ? packageStartTime : null,
        package_end_time: selectedPackage !== "none" ? packageEndTime : null,
        package_cost: packageCost,
        setup_breakdown: setupBreakdown,
        tablecloths,
        tablecloth_quantity: tablecloths ? tableclothQuantity : 0,
        optional_services_cost: optionalServicesCost,
        total_amount: totalAmount,
        payment_status: "pending",
      };

      const { data: insertedInvoice, error: insertError } = await supabase
        .from("booking_addon_invoices" as any)
        .insert(invoiceData)
        .select("id")
        .single();

      if (insertError || !insertedInvoice) {
        console.error("Error creating addon invoice:", insertError);
        toast({ title: "Failed to create invoice", variant: "destructive" });
        return;
      }

      const invoiceId = (insertedInvoice as any).id;

      const { data: fnResult, error: fnError } = await supabase.functions.invoke(
        "create-addon-invoice",
        {
          body: {
            invoice_id: invoiceId,
            customer_email: customerEmail,
            customer_name: customerName,
            event_date: eventDate,
            reservation_number: reservationNumber,
          },
        }
      );

      if (fnError) {
        console.error("Error calling create-addon-invoice:", fnError);
        toast({
          title: "Invoice created but failed to generate payment link",
          variant: "destructive",
        });
      } else {
        toast({ title: "Invoice sent to client successfully" });
      }

      resetForm();
      onOpenChange(false);
      onInvoiceCreated();
    } catch (error) {
      console.error("Error creating addon invoice:", error);
      toast({ title: "Something went wrong", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Add-On Invoice</DialogTitle>
          <DialogDescription>
            Select additional packages or services for this booking. A payment link will be emailed to the client.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 mt-2">
          {/* Production Packages */}
          <div className="space-y-3">
            <Label className="text-base font-semibold">Production Packages</Label>
            <p className="text-sm text-muted-foreground">Charged per hour</p>
            <RadioGroup value={selectedPackage} onValueChange={setSelectedPackage} className="space-y-2">
              <div className="flex items-start space-x-3 border rounded-lg p-3 hover:bg-accent/50 transition-colors">
                <RadioGroupItem value="none" id="addon-none" className="mt-1" />
                <label htmlFor="addon-none" className="flex-1 cursor-pointer">
                  <div className="font-semibold text-sm">No Package</div>
                  <div className="text-xs text-muted-foreground">Services only</div>
                </label>
              </div>
              <div className="flex items-start space-x-3 border rounded-lg p-3 hover:bg-accent/50 transition-colors">
                <RadioGroupItem value="basic" id="addon-basic" className="mt-1" />
                <label htmlFor="addon-basic" className="flex-1 cursor-pointer">
                  <div className="font-semibold text-sm">Basic Package — $79/hr</div>
                  <div className="text-xs text-muted-foreground">AV System, Microphones, Speakers, Projectors, Tech Assistant</div>
                </label>
              </div>
              <div className="flex items-start space-x-3 border rounded-lg p-3 hover:bg-accent/50 transition-colors">
                <RadioGroupItem value="led" id="addon-led" className="mt-1" />
                <label htmlFor="addon-led" className="flex-1 cursor-pointer">
                  <div className="font-semibold text-sm">LED Package — $99/hr</div>
                  <div className="text-xs text-muted-foreground">Basic + Stage LED Wall</div>
                </label>
              </div>
              <div className="flex items-start space-x-3 border rounded-lg p-3 hover:bg-accent/50 transition-colors">
                <RadioGroupItem value="workshop" id="addon-workshop" className="mt-1" />
                <label htmlFor="addon-workshop" className="flex-1 cursor-pointer">
                  <div className="font-semibold text-sm">Workshop Package — $149/hr</div>
                  <div className="text-xs text-muted-foreground">LED + Streaming Equipment + Streaming Tech</div>
                </label>
              </div>
            </RadioGroup>
          </div>

          {/* Package Time Selection */}
          {selectedPackage !== "none" && (
            <div className="border rounded-lg p-4 bg-accent/20 space-y-3">
              <Label className="font-semibold text-sm">Package Time (min {MIN_PACKAGE_HOURS} hours)</Label>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label className="text-xs">Start Time</Label>
                  <Input
                    type="time"
                    value={packageStartTime}
                    onChange={(e) => setPackageStartTime(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">End Time</Label>
                  <Input
                    type="time"
                    value={packageEndTime}
                    onChange={(e) => setPackageEndTime(e.target.value)}
                  />
                </div>
              </div>
              {packageHours > 0 && (
                <p className="text-sm text-muted-foreground">
                  {packageHours} hours x ${PACKAGE_RATES[selectedPackage]}/hr = <strong>${packageCost.toFixed(2)}</strong>
                </p>
              )}
            </div>
          )}

          {/* Optional Services */}
          <div className="space-y-3">
            <Label className="text-base font-semibold">Optional Services</Label>
            <p className="text-sm text-muted-foreground">Additional flat-rate services</p>

            <div className="flex items-start space-x-3 border rounded-lg p-3">
              <Checkbox
                id="addon-setup"
                checked={setupBreakdown}
                onCheckedChange={(checked) => setSetupBreakdown(checked as boolean)}
              />
              <label htmlFor="addon-setup" className="flex-1 cursor-pointer">
                <div className="font-semibold text-sm">Setup & Breakdown of Chairs/Tables — $100</div>
                <div className="text-xs text-muted-foreground">We'll handle all furniture setup and breakdown</div>
              </label>
            </div>

            <div className="flex items-start space-x-3 border rounded-lg p-3">
              <Checkbox
                id="addon-tablecloths"
                checked={tablecloths}
                onCheckedChange={(checked) => setTablecloths(checked as boolean)}
              />
              <label htmlFor="addon-tablecloths" className="flex-1 cursor-pointer">
                <div className="font-semibold text-sm">Tablecloth Rental — $5 each + $25 cleaning fee</div>
                <div className="text-xs text-muted-foreground">Professional tablecloths (max {MAX_TABLECLOTHS})</div>
              </label>
            </div>

            {tablecloths && (
              <div className="ml-8 space-y-1">
                <Label className="text-xs">Number of Tablecloths</Label>
                <Input
                  type="number"
                  min={1}
                  max={MAX_TABLECLOTHS}
                  value={tableclothQuantity}
                  onChange={(e) => setTableclothQuantity(Math.min(MAX_TABLECLOTHS, Math.max(1, Number(e.target.value))))}
                  className="max-w-[120px]"
                />
              </div>
            )}
          </div>

          <Separator />

          {/* Pricing Summary */}
          <div className="bg-accent/30 rounded-lg p-4 space-y-2">
            <h4 className="font-semibold">Invoice Summary</h4>
            <div className="space-y-1 text-sm">
              {packageCost > 0 && (
                <div className="flex justify-between">
                  <span>{PACKAGE_LABELS[selectedPackage]} ({packageHours}h)</span>
                  <span>${packageCost.toFixed(2)}</span>
                </div>
              )}
              {setupBreakdown && (
                <div className="flex justify-between">
                  <span>Setup & Breakdown</span>
                  <span>${SETUP_BREAKDOWN_COST.toFixed(2)}</span>
                </div>
              )}
              {tablecloths && tableclothQuantity > 0 && (
                <div className="flex justify-between">
                  <span>Tablecloths ({tableclothQuantity} x $5 + $25 cleaning)</span>
                  <span>${(tableclothQuantity * TABLECLOTH_UNIT_COST + TABLECLOTH_CLEANING_FEE).toFixed(2)}</span>
                </div>
              )}
              <Separator className="my-2" />
              <div className="flex justify-between font-bold text-base">
                <span>Total</span>
                <span>${totalAmount.toFixed(2)}</span>
              </div>
            </div>
          </div>

          <p className="text-xs text-muted-foreground text-center">
            A payment link will be sent to <strong>{customerEmail}</strong>
          </p>

          <Button
            onClick={handleSubmit}
            className="w-full"
            size="lg"
            disabled={submitting || !!validationError}
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Creating Invoice...
              </>
            ) : (
              <>
                <Send className="h-4 w-4 mr-2" />
                Send Invoice (${totalAmount.toFixed(2)})
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
