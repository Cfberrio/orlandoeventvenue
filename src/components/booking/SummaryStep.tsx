import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { BookingFormData } from "@/pages/Book";
import { format } from "date-fns";
import { Edit, Tag, Check, X, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePricing } from "@/hooks/usePricing";
import { useBarPackages, getBarLabel } from "@/hooks/useBarPackages";
import { checkCouponForBooking, computeBookingPrice, feeCentsFor, toCents, type CouponTerms } from "@/lib/bookingPricing";

interface SummaryStepProps {
  data: Partial<BookingFormData>;
  updateData: (data: Partial<BookingFormData>) => void;
  onNext: () => void;
  onBack: () => void;
  goToStep: (step: number) => void;
}

const SummaryStep = ({ data, updateData, onNext, onBack, goToStep }: SummaryStepProps) => {
  const { pricing: p, isLoading: pricingLoading } = usePricing();
  const { packages: barPackages } = useBarPackages();
  const [discountCode, setDiscountCode] = useState("");
  // Terms of the validated code. The dollar amount is computed by the shared
  // pricing engine (same code create-checkout uses to re-check the booking).
  const [appliedDiscount, setAppliedDiscount] = useState<CouponTerms | null>(null);
  const [discountError, setDiscountError] = useState("");
  const [isValidatingCode, setIsValidatingCode] = useState(false);

  const applyDiscountCode = async () => {
    const code = discountCode.trim().toUpperCase();

    if (!code) {
      setDiscountError("Please enter a discount code");
      return;
    }

    setIsValidatingCode(true);
    try {
      // One code at a time, active only (the coupon table itself is not public).
      // validate_discount_code is newer than the generated Supabase types.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: rows, error } = await (supabase.rpc as any)("validate_discount_code", { p_code: code });

      if (error) {
        console.error("Error checking coupon:", error);
        setDiscountError("We couldn't check that code. Please try again.");
        return;
      }

      const dbCoupon = Array.isArray(rows) ? rows[0] : rows;
      if (!dbCoupon) {
        setDiscountError("Invalid discount code");
        return;
      }

      const terms: CouponTerms = {
        code: dbCoupon.code,
        discount_type: dbCoupon.discount_type === "percentage" ? "percentage" : "fixed_amount",
        discount_value: Number(dbCoupon.discount_value),
        applies_to: dbCoupon.applies_to === "total" ? "total" : "base_rental",
        applies_to_hourly: !!dbCoupon.applies_to_hourly,
        applies_to_daily: !!dbCoupon.applies_to_daily,
      };

      const check = checkCouponForBooking(terms, data.bookingType === "daily" ? "daily" : "hourly");
      if ("allowed" in check) {
        setDiscountError(
          check.allowed === "none"
            ? "This code can't be used for online bookings"
            : `This code only applies to ${check.allowed} bookings`
        );
        return;
      }

      setAppliedDiscount(terms);
      setDiscountError("");
    } catch (err) {
      console.error("Unexpected error:", err);
      setDiscountError("We couldn't check that code. Please try again.");
    } finally {
      setIsValidatingCode(false);
    }
  };

  const removeDiscount = () => {
    setAppliedDiscount(null);
    setDiscountCode("");
    setDiscountError("");
  };

  useEffect(() => {
    if (pricingLoading) return;

    const price = computeBookingPrice(
      {
        bookingType: data.bookingType === "daily" ? "daily" : "hourly",
        startTime: data.startTime,
        endTime: data.endTime,
        package: (data.package || "none") as "none" | "basic" | "led" | "workshop",
        packageStartTime: data.packageStartTime,
        packageEndTime: data.packageEndTime,
        setupBreakdown: data.setupBreakdown,
        tablecloths: data.tablecloths,
        tableclothQuantity: data.tableclothQuantity,
        barSubtotal: data.barPackage && data.barPackage !== "none" ? Number(data.barSubtotal) || 0 : 0,
      },
      p,
      appliedDiscount,
    );

    updateData({
      pricing: {
        baseRental: price.baseRental,
        cleaningFee: price.cleaningFee,
        packageCost: price.packageCost,
        optionalServices: price.optionalServices,
        discount: price.discount?.amount ?? 0,
        discountCode: price.discount?.code,
        discountDescription: price.discount?.description,
        processingFee: price.depositFee,
        total: price.total,
        deposit: price.deposit,
        balance: price.balance,
      },
    });
  }, [data, updateData, appliedDiscount, p, pricingLoading]);

  const packageNames: Record<string, string> = {
    none: "No Package",
    basic: "Basic Package",
    led: "LED Package",
    workshop: "Workshop Package",
  };

  const eventTypeNames: Record<string, string> = {
    "birthday-party": "Birthday Party",
    "baby-shower": "Baby Shower",
    "bridal-shower": "Bridal Shower",
    "wedding-reception": "Wedding Reception",
    "graduation-party": "Graduation Party",
    "corporate-meeting": "Corporate Meeting / Team Meeting",
    "training-seminar": "Training / Seminar",
    "workshop-class": "Workshop / Class",
    "networking-mixer": "Networking Mixer / Meetup",
    "celebration-of-life": "Celebration of Life / Memorial Reception",
    other: data.eventTypeOther || "Other",
  };

  if (pricingLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

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
                {data.package !== "none" && data.packageStartTime && data.packageEndTime && (
                  <span> ({data.packageStartTime} - {data.packageEndTime})</span>
                )}
              </p>
              {data.setupBreakdown && <p>• Setup & Breakdown of Chairs/Tables</p>}
              {data.tablecloths && (
                <p>
                  • Tablecloth Rental ({data.tableclothQuantity} tablecloths)
                </p>
              )}
              {data.barPackage && data.barPackage !== "none" && (
                <p>
                  • Bar Service: {getBarLabel(barPackages, data.barPackage) || data.barPackage} ({data.barGuestCount} guests)
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

      {/* Discount Code Section */}
      <div className="bg-accent/20 rounded-lg p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Tag className="h-4 w-4 text-primary" />
          <h3 className="font-semibold">Have a Discount Code?</h3>
        </div>
        
        {!appliedDiscount ? (
          <div className="flex gap-2">
            <Input
              type="text"
              placeholder="Enter discount code"
              value={discountCode}
              onChange={(e) => {
                setDiscountCode(e.target.value.toUpperCase());
                setDiscountError("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  applyDiscountCode();
                }
              }}
              className="flex-1"
            />
            <Button
              type="button"
              onClick={applyDiscountCode}
              variant="outline"
              disabled={isValidatingCode}
            >
              {isValidatingCode ? <Loader2 className="h-4 w-4 animate-spin" /> : "Apply"}
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-between bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900 rounded-md p-3">
            <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
              <Check className="h-4 w-4" />
              <span className="font-medium">
                {appliedDiscount.code} applied
                {data.pricing?.discountDescription ? ` (${data.pricing.discountDescription})` : ""}
              </span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={removeDiscount}
              className="h-8 text-red-600 hover:text-red-700 hover:bg-red-50"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}
        
        {discountError && (
          <p className="text-sm text-red-600 dark:text-red-400">{discountError}</p>
        )}
      </div>

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
            {data.barPackage && data.barPackage !== "none" && (data.barSubtotal || 0) > 0 && (
              <div className="flex justify-between">
                <span>
                  Bar Service: {getBarLabel(barPackages, data.barPackage) || ""}{" "}
                  <span className="text-muted-foreground">
                    ({data.barGuestCount} × ${(data.barRatePerGuest || 0).toFixed(2)}/guest)
                  </span>
                </span>
                <span>${(data.barSubtotal || 0).toFixed(2)}</span>
              </div>
            )}
            {data.pricing.discount && data.pricing.discount > 0 && (
              <div className="flex justify-between text-green-600 dark:text-green-400">
                <span>
                  Discount ({data.pricing.discountCode})
                  {data.pricing.discountDescription && (
                    <span className="block text-xs opacity-80">{data.pricing.discountDescription}</span>
                  )}
                </span>
                <span>-${data.pricing.discount.toFixed(2)}</span>
              </div>
            )}
          </div>

          <Separator className="my-4" />

          <div className="space-y-2 font-semibold">
            <div className="flex justify-between text-lg">
              <span>Subtotal</span>
              <span>${data.pricing.total.toFixed(2)}</span>
            </div>
          </div>

          <Separator className="my-4" />

          <div className="space-y-2">
            <div className="flex justify-between font-semibold text-primary">
              <span>Deposit Due Today ({p.deposit_percentage}%)</span>
              <span>${(data.pricing.deposit + data.pricing.processingFee).toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm text-muted-foreground ml-4">
              <span>Base amount</span>
              <span>${data.pricing.deposit.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm text-muted-foreground ml-4">
              <span>Processing Fee ({p.processing_fee}%)</span>
              <span>${data.pricing.processingFee.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-muted-foreground text-sm font-normal pt-2">
              <span>Balance Due (15 days before event)</span>
              <span>${((toCents(data.pricing.balance) + feeCentsFor(toCents(data.pricing.balance), p.processing_fee)) / 100).toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-xs text-muted-foreground ml-4">
              <span>${data.pricing.balance.toFixed(2)} + {p.processing_fee}% fee at payment</span>
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
