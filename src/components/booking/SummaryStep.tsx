import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { BookingFormData } from "@/pages/Book";
import { format } from "date-fns";
import { Edit, Tag, Check, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface SummaryStepProps {
  data: Partial<BookingFormData>;
  updateData: (data: Partial<BookingFormData>) => void;
  onNext: () => void;
  onBack: () => void;
  goToStep: (step: number) => void;
}

const SummaryStep = ({ data, updateData, onNext, onBack, goToStep }: SummaryStepProps) => {
  const [discountCode, setDiscountCode] = useState("");
  const [appliedDiscount, setAppliedDiscount] = useState<{
    code: string;
    percentage?: number;
    amount: number;
    type: "rental" | "cleaning_fee";
  } | null>(null);
  const [discountError, setDiscountError] = useState("");

  // Available discount codes
  // Percentage codes: discount % of base rental
  // Special code "199": $199 off cleaning fee (any booking type)
  const discountCodes: Record<string, number | { type: "cleaning_fee"; amount: number }> = {
    "CHRIS": 40, // 40% off base rental (hourly only)
    "NANO": 50,  // 50% off base rental (hourly AND daily)
    "199": { type: "cleaning_fee", amount: 199 }, // $199 off cleaning fee
  };

  const applyDiscountCode = async () => {
    const code = discountCode.trim().toUpperCase();
    
    if (!code) {
      setDiscountError("Please enter a discount code");
      return;
    }

    // First, check hardcoded coupons (priority)
    const discountConfig = discountCodes[code];
    
    if (discountConfig) {
      // Check if it's a cleaning fee discount (special code "199")
      if (typeof discountConfig === "object" && discountConfig.type === "cleaning_fee") {
        setAppliedDiscount({
          code,
          amount: discountConfig.amount,
          type: "cleaning_fee",
        });
        setDiscountError("");
        return;
      }

      // For percentage-based discounts
      // NANO applies to both hourly and daily, others only hourly
      const allowDailyBookings = code === "NANO";
      if (data.bookingType !== "hourly" && !allowDailyBookings) {
        setDiscountError("This discount code only applies to hourly bookings");
        return;
      }

      const percentage = discountConfig as number;

      // Calculate discount amount based on base rental
      let baseRental = 0;
      if (data.bookingType === "hourly" && data.startTime && data.endTime) {
        const start = new Date(`2000-01-01T${data.startTime}`);
        const end = new Date(`2000-01-01T${data.endTime}`);
        const hours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
        baseRental = 140 * hours;
      } else if (data.bookingType === "daily") {
        baseRental = 899;
      }

      const discountAmount = Math.round((baseRental * percentage) / 100);

      setAppliedDiscount({
        code,
        percentage,
        amount: discountAmount,
        type: "rental",
      });
      setDiscountError("");
      return;
    }

    // If not found in hardcoded, check database coupons
    try {
      // Type for discount coupons (until types regenerate)
      type DiscountCoupon = {
        id: string;
        code: string;
        discount_type: 'percentage' | 'fixed_amount';
        discount_value: number;
        applies_to: string;
        applies_to_hourly: boolean;
        applies_to_daily: boolean;
        is_active: boolean;
        created_at: string;
        updated_at: string;
      };
      
      const { data: dbCoupon, error } = await supabase
        .from("discount_coupons" as any)
        .select("*")
        .eq("code", code)
        .eq("is_active", true)
        .maybeSingle() as { data: DiscountCoupon | null; error: any };

      if (error) {
        console.error("Error checking coupon:", error);
        setDiscountError("Error validating coupon code");
        return;
      }

      if (!dbCoupon) {
        setDiscountError("Invalid discount code");
        return;
      }

      // Check if coupon applies to this booking type
      const appliesToThisType = 
        (data.bookingType === "hourly" && dbCoupon.applies_to_hourly) ||
        (data.bookingType === "daily" && dbCoupon.applies_to_daily);

      if (!appliesToThisType) {
        setDiscountError(`This code only applies to ${
          dbCoupon.applies_to_hourly && dbCoupon.applies_to_daily ? "all" :
          dbCoupon.applies_to_hourly ? "hourly" : "daily"
        } bookings`);
        return;
      }

      // Calculate base rental
      let baseRental = 0;
      if (data.bookingType === "hourly" && data.startTime && data.endTime) {
        const start = new Date(`2000-01-01T${data.startTime}`);
        const end = new Date(`2000-01-01T${data.endTime}`);
        const hours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
        baseRental = 140 * hours;
      } else if (data.bookingType === "daily") {
        baseRental = 899;
      }

      // Calculate discount based on type
      let discountAmount = 0;
      if (dbCoupon.discount_type === "percentage") {
        discountAmount = Math.round((baseRental * dbCoupon.discount_value) / 100);
      } else {
        // fixed_amount
        discountAmount = Math.min(dbCoupon.discount_value, baseRental); // Cap at base rental
      }

      setAppliedDiscount({
        code: dbCoupon.code,
        percentage: dbCoupon.discount_type === "percentage" ? dbCoupon.discount_value : undefined,
        amount: discountAmount,
        type: "rental",
      });
      setDiscountError("");
    } catch (err) {
      console.error("Unexpected error:", err);
      setDiscountError("Error validating coupon code");
    }
  };

  const removeDiscount = () => {
    setAppliedDiscount(null);
    setDiscountCode("");
    setDiscountError("");
  };

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

      let cleaningFee = 199;
      let rentalDiscount = 0;

      // Apply discounts
      if (appliedDiscount) {
        if (appliedDiscount.type === "cleaning_fee") {
          // Discount applied to cleaning fee
          cleaningFee = Math.max(0, cleaningFee - appliedDiscount.amount);
        } else {
          // Discount applied to base rental (hourly or daily, depending on code)
          rentalDiscount = appliedDiscount.amount;
        }
      }

      const packageRates: Record<string, number> = {
        none: 0,
        basic: 79,
        led: 99,
        workshop: 149,
      };
      
      let packageHours = 0;
      if (data.package !== "none" && data.packageStartTime && data.packageEndTime) {
        const start = new Date(`2000-01-01T${data.packageStartTime}`);
        const end = new Date(`2000-01-01T${data.packageEndTime}`);
        packageHours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
      }
      const packageCost = (packageRates[data.package || "none"] || 0) * packageHours;

      let optionalServices = 0;
      if (data.setupBreakdown) optionalServices += 100;
      if (data.tablecloths && data.tableclothQuantity) {
        optionalServices += data.tableclothQuantity * 5 + 25;
      }

      const total = baseRental + cleaningFee + packageCost + optionalServices - rentalDiscount;
      const deposit = Math.round(total * 0.5);
      const balance = total - deposit;

      updateData({
        pricing: {
          baseRental,
          cleaningFee,
          packageCost,
          optionalServices,
          discount: appliedDiscount ? appliedDiscount.amount : 0,
          discountCode: appliedDiscount?.code,
          total,
          deposit,
          balance,
        },
      });
    };

    calculatePricing();
  }, [data, updateData, appliedDiscount]);

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
            >
              Apply
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-between bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900 rounded-md p-3">
            <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
              <Check className="h-4 w-4" />
              <span className="font-medium">
                {appliedDiscount.code} applied
                {appliedDiscount.type === "cleaning_fee" 
                  ? " (Free cleaning)" 
                  : ` (${appliedDiscount.percentage}% off)`
                }
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
            {data.pricing.discount && data.pricing.discount > 0 && (
              <div className="flex justify-between text-green-600 dark:text-green-400">
                <span>Discount ({data.pricing.discountCode})</span>
                <span>-${data.pricing.discount.toFixed(2)}</span>
              </div>
            )}
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
