import { Button } from "@/components/ui/button";
import { BookingFormData } from "@/pages/Book";
import { Card } from "@/components/ui/card";
import { CheckCircle2, CreditCard, Loader2, Shield } from "lucide-react";
import { useState, useEffect } from "react";
import { format, addDays } from "date-fns";
import { useCreateBooking } from "@/hooks/useCreateBooking";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSearchParams } from "react-router-dom";

interface PaymentStepProps {
  data: Partial<BookingFormData>;
  updateData: (data: Partial<BookingFormData>) => void;
  onBack: () => void;
}

const PaymentStep = ({ data, updateData, onBack }: PaymentStepProps) => {
  const [isPaid, setIsPaid] = useState(false);
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const createBooking = useCreateBooking();
  const [searchParams] = useSearchParams();

  // Check if returning from successful Stripe payment
  useEffect(() => {
    const sessionId = searchParams.get("session_id");
    const returnedBookingId = searchParams.get("booking_id");
    
    if (sessionId && returnedBookingId) {
      setBookingId(returnedBookingId);
      setIsPaid(true);
      updateData({ paymentStatus: "paid" });
      toast.success("Payment successful!", {
        description: "Your deposit has been received.",
      });
    }
  }, [searchParams, updateData]);

  const handlePayment = async () => {
    setIsProcessing(true);
    
    try {
      // First, create the booking in the database
      const result = await createBooking.mutateAsync(data);
      const newBookingId = result.bookingId;
      setBookingId(newBookingId);
      
      console.log("Booking created:", newBookingId);
      console.log("Creating Stripe checkout session...");

      // Create Stripe checkout session
      const { data: checkoutData, error } = await supabase.functions.invoke("create-checkout", {
        body: {
          bookingId: newBookingId,
          depositAmount: data.pricing?.deposit || 0,
          customerEmail: data.email || "",
          customerName: data.fullName || "",
          eventDate: data.date ? format(data.date, "PPP") : "",
          eventType: data.eventType || "Event",
          successUrl: `${window.location.origin}/booking-confirmation`,
          cancelUrl: `${window.location.origin}/booking-confirmation`,
        },
      });

      if (error) {
        console.error("Checkout error:", error);
        throw new Error(error.message || "Failed to create checkout session");
      }

      console.log("Checkout session created:", checkoutData);

      // Redirect to Stripe Checkout
      if (checkoutData?.url) {
        window.location.href = checkoutData.url;
      } else {
        throw new Error("No checkout URL returned");
      }
    } catch (error) {
      console.error("Payment/booking error:", error);
      toast.error("Failed to process payment", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
      setIsProcessing(false);
    }
  };

  if (isPaid) {
    const balanceDueDate = data.date ? addDays(data.date, -15) : new Date();

    return (
      <div className="text-center space-y-6 py-8">
        <div className="flex justify-center">
          <CheckCircle2 className="h-20 w-20 text-green-500" />
        </div>
        
        <div>
          <h2 className="text-3xl font-bold mb-2">Payment Received!</h2>
          <p className="text-lg text-muted-foreground">
            Pending Confirmation
          </p>
          {bookingId && (
            <p className="text-sm text-muted-foreground mt-2">
              Booking Reference: <span className="font-mono">{bookingId.slice(0, 8).toUpperCase()}</span>
            </p>
          )}
        </div>

        <Card className="p-6 bg-accent/30 text-left max-w-2xl mx-auto">
          <div className="space-y-4">
            <div>
              <p className="text-sm text-muted-foreground">You paid (50% Deposit)</p>
              <p className="text-2xl font-bold text-green-600">
                ${data.pricing?.deposit.toFixed(2)}
              </p>
            </div>

            <div>
              <p className="text-sm text-muted-foreground">Balance Due</p>
              <p className="text-xl font-semibold">
                ${data.pricing?.balance.toFixed(2)}
              </p>
              <p className="text-sm text-muted-foreground">
                Due on {format(balanceDueDate, "PPP")} (15 days before your event)
              </p>
            </div>

            <div className="pt-4 border-t">
              <p className="text-sm font-medium mb-2">What's Next?</p>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• You'll receive a confirmation email within 24 hours</li>
                <li>• Please hold off on sending invites until confirmed</li>
                <li>• Your balance will be automatically charged 15 days before the event</li>
                <li>• Access instructions will be sent 72 hours before your event</li>
              </ul>
            </div>
          </div>
        </Card>

        <Button size="lg" onClick={() => window.location.href = "/"}>
          Return to Home
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-4">Payment</h2>
        <p className="text-muted-foreground mb-6">
          Complete your booking with a 50% deposit
        </p>
      </div>

      <Card className="p-6 bg-accent/30">
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <span className="font-semibold">Deposit Due Today (50%)</span>
            <span className="text-2xl font-bold text-primary">
              ${data.pricing?.deposit.toFixed(2)}
            </span>
          </div>
          
          <div className="flex justify-between items-center text-sm">
            <span className="text-muted-foreground">Remaining Balance</span>
            <span>${data.pricing?.balance.toFixed(2)}</span>
          </div>

          <div className="text-sm text-muted-foreground pt-2 border-t">
            <p>
              The remaining 50% will be due 15 days before your event date. 
              {data.date && (
                <> That's <strong>{format(addDays(data.date, -15), "PPP")}</strong>.</>
              )}
            </p>
          </div>
        </div>
      </Card>

      <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4 text-sm">
        <div className="flex items-center gap-2 mb-2">
          <Shield className="h-4 w-4 text-blue-600" />
          <p className="font-semibold">Secure Payment via Stripe:</p>
        </div>
        <ul className="space-y-1 text-muted-foreground">
          <li>• Your card will be securely saved for the balance payment</li>
          <li>• Booking status will be "Pending Review" until confirmed</li>
          <li>• You'll receive a confirmation email within 24 hours</li>
          <li>• Full refund available if booking is not confirmed</li>
        </ul>
      </div>

      <div className="flex justify-between pt-4">
        <Button 
          type="button" 
          variant="outline" 
          onClick={onBack} 
          disabled={isProcessing || createBooking.isPending}
        >
          Back
        </Button>
        <Button 
          size="lg" 
          onClick={handlePayment} 
          disabled={isProcessing || createBooking.isPending}
        >
          {isProcessing || createBooking.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Processing...
            </>
          ) : (
            <>
              <CreditCard className="mr-2 h-4 w-4" />
              Pay ${data.pricing?.deposit.toFixed(2)} Now
            </>
          )}
        </Button>
      </div>
    </div>
  );
};

export default PaymentStep;
