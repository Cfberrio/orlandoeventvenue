import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { BookingFormData } from "@/pages/Book";
import { format } from "date-fns";
import { Edit } from "lucide-react";

interface SummaryStepProps {
  data: Partial<BookingFormData>;
  updateData: (data: Partial<BookingFormData>) => void;
  onNext: () => void;
  onBack: () => void;
  goToStep: (step: number) => void;
}

const SummaryStep = ({ data, updateData, onNext, onBack, goToStep }: SummaryStepProps) => {
  useEffect(() => {
    // Calculate pricing
    const calculatePricing = () => {
      let baseRental = 0;
      let hours = 0;

      if (data.bookingType === "hourly" && data.startTime && data.endTime) {
        const start = new Date(`2000-01-01T${data.startTime}`);
        const end = new Date(`2000-01-01T${data.endTime}`);
        hours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
        baseRental = 140 * hours;
      } else if (data.bookingType === "daily") {
        hours = 24;
        baseRental = 899;
      }

      const cleaningFee = 199;

      const packageRates: Record<string, number> = {
        none: 0,
        basic: 79,
        led: 99,
        workshop: 149,
      };
      const packageCost = (packageRates[data.package || "none"] || 0) * hours;

      let optionalServices = 0;
      if (data.setupBreakdown) optionalServices += 100;
      if (data.tablecloths && data.tableclothQuantity) {
        optionalServices += data.tableclothQuantity * 5 + 25;
      }

      const subtotal = baseRental + cleaningFee + packageCost + optionalServices;
      const taxes = subtotal * 0.07; // 7% tax estimate
      const total = subtotal + taxes;
      const deposit = Math.round(total * 0.5);
      const balance = total - deposit;

      updateData({
        pricing: {
          baseRental,
          cleaningFee,
          packageCost,
          optionalServices,
          taxes,
          total,
          deposit,
          balance,
        },
      });
    };

    calculatePricing();
  }, [data, updateData]);

  const packageNames: Record<string, string> = {
    none: "No Package",
    basic: "Basic Package",
    led: "LED Package",
    workshop: "Workshop Package",
  };

  const eventTypeNames: Record<string, string> = {
    "corporate-offsite": "Corporate Offsite",
    training: "Training",
    workshop: "Workshop",
    meetup: "Meetup",
    celebration: "Celebration",
    "brand-launch": "Brand Launch/Showcase",
    other: data.eventTypeOther || "Other",
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-4">Booking Summary</h2>
        <p className="text-muted-foreground mb-6">
          Review your booking details and pricing
        </p>
      </div>

      {/* Booking Details */}
      <div className="space-y-4">
        <div className="flex justify-between items-start">
          <div>
            <h3 className="font-semibold text-lg mb-2">Booking Details</h3>
            <div className="space-y-1 text-sm">
              <p>
                <span className="text-muted-foreground">Type:</span>{" "}
                {data.bookingType === "hourly" ? "Hourly Rental" : "Daily Rental (24 hours)"}
              </p>
              <p>
                <span className="text-muted-foreground">Date:</span>{" "}
                {data.date ? format(data.date, "PPP") : "Not set"}
              </p>
              {data.bookingType === "hourly" && (
                <p>
                  <span className="text-muted-foreground">Time:</span>{" "}
                  {data.startTime} - {data.endTime}
                </p>
              )}
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => goToStep(1)}>
            <Edit className="h-4 w-4 mr-1" />
            Edit
          </Button>
        </div>

        <Separator />

        <div className="flex justify-between items-start">
          <div>
            <h3 className="font-semibold text-lg mb-2">Event Details</h3>
            <div className="space-y-1 text-sm">
              <p>
                <span className="text-muted-foreground">Guests:</span> {data.numberOfGuests}
              </p>
              <p>
                <span className="text-muted-foreground">Event Type:</span>{" "}
                {eventTypeNames[data.eventType || ""] || "Not set"}
              </p>
              {data.notes && (
                <p>
                  <span className="text-muted-foreground">Notes:</span> {data.notes}
                </p>
              )}
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => goToStep(2)}>
            <Edit className="h-4 w-4 mr-1" />
            Edit
          </Button>
        </div>

        <Separator />

        <div className="flex justify-between items-start">
          <div>
            <h3 className="font-semibold text-lg mb-2">Add-Ons</h3>
            <div className="space-y-1 text-sm">
              <p>
                <span className="text-muted-foreground">Package:</span>{" "}
                {packageNames[data.package || "none"]}
              </p>
              {data.setupBreakdown && <p>• Setup & Breakdown of Chairs/Tables</p>}
              {data.tablecloths && (
                <p>
                  • Tablecloth Rental ({data.tableclothQuantity} tablecloths)
                </p>
              )}
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => goToStep(3)}>
            <Edit className="h-4 w-4 mr-1" />
            Edit
          </Button>
        </div>
      </div>

      <Separator className="my-6" />

      {/* Pricing Breakdown */}
      {data.pricing && (
        <div className="bg-accent/30 rounded-lg p-6 space-y-3">
          <h3 className="font-semibold text-lg mb-4">Pricing Breakdown</h3>
          
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span>Base Rental</span>
              <span>${data.pricing.baseRental.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span>Cleaning Fee</span>
              <span>${data.pricing.cleaningFee.toFixed(2)}</span>
            </div>
            {data.pricing.packageCost > 0 && (
              <div className="flex justify-between">
                <span>Production Package</span>
                <span>${data.pricing.packageCost.toFixed(2)}</span>
              </div>
            )}
            {data.pricing.optionalServices > 0 && (
              <div className="flex justify-between">
                <span>Optional Services</span>
                <span>${data.pricing.optionalServices.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between text-muted-foreground">
              <span>Taxes & Fees (est.)</span>
              <span>${data.pricing.taxes.toFixed(2)}</span>
            </div>
          </div>

          <Separator className="my-4" />

          <div className="space-y-2 font-semibold">
            <div className="flex justify-between text-lg">
              <span>Grand Total</span>
              <span>${data.pricing.total.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-primary">
              <span>Deposit Due Today (50%)</span>
              <span>${data.pricing.deposit.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-muted-foreground text-sm font-normal">
              <span>Balance Due (15 days before event)</span>
              <span>${data.pricing.balance.toFixed(2)}</span>
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-between pt-4">
        <Button type="button" variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button size="lg" onClick={onNext}>
          Continue to Contact & Policies
        </Button>
      </div>
    </div>
  );
};

export default SummaryStep;
