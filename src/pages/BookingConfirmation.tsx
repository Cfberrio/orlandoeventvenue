import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Navigation from "@/components/Navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, Loader2, Calendar, Clock, Users, Copy, Check } from "lucide-react";
import { format, addDays } from "date-fns";
import { toast } from "sonner";

interface BookingDetails {
  id: string;
  reservation_number: string;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  booking_type: string;
  number_of_guests: number;
  event_type: string;
  deposit_amount: number;
  balance_amount: number;
  total_amount: number;
  full_name: string;
  email: string;
  payment_status: string;
}

const BookingConfirmation = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [booking, setBooking] = useState<BookingDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const sessionId = searchParams.get("session_id");
  const bookingId = searchParams.get("booking_id");
  const cancelled = searchParams.get("cancelled");

  useEffect(() => {
    const fetchBooking = async () => {
      if (!bookingId) {
        setError("No booking ID provided");
        setLoading(false);
        return;
      }

      // Small delay to allow webhook to process
      await new Promise(resolve => setTimeout(resolve, 2000));

      const { data, error: fetchError } = await supabase
        .from("bookings")
        .select("id, reservation_number, event_date, start_time, end_time, booking_type, number_of_guests, event_type, deposit_amount, balance_amount, total_amount, full_name, email, payment_status")
        .eq("id", bookingId)
        .maybeSingle();

      if (fetchError) {
        console.error("Error fetching booking:", fetchError);
        setError("Failed to load booking details");
        setLoading(false);
        return;
      }

      if (!data) {
        setError("Booking not found");
        setLoading(false);
        return;
      }

      setBooking(data);
      setLoading(false);
    };

    fetchBooking();
  }, [bookingId]);

  const copyReservationNumber = () => {
    if (booking?.reservation_number) {
      navigator.clipboard.writeText(booking.reservation_number);
      setCopied(true);
      toast.success("Reservation number copied!");
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-background to-accent/10">
        <Navigation />
        <div className="container mx-auto px-4 py-20 flex items-center justify-center">
          <div className="text-center space-y-4">
            <Loader2 className="h-12 w-12 animate-spin mx-auto text-primary" />
            <p className="text-muted-foreground">Processing your payment...</p>
          </div>
        </div>
      </div>
    );
  }

  // Payment cancelled/failed
  if (cancelled || error) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-background to-accent/10">
        <Navigation />
        <div className="container mx-auto px-4 py-20">
          <div className="max-w-2xl mx-auto text-center space-y-6">
            <div className="flex justify-center">
              <XCircle className="h-20 w-20 text-destructive" />
            </div>
            
            <div>
              <h1 className="text-3xl font-bold mb-2">Payment {cancelled ? "Cancelled" : "Failed"}</h1>
              <p className="text-lg text-muted-foreground">
                {cancelled 
                  ? "Your payment was cancelled. No charges were made." 
                  : error || "Something went wrong with your payment."}
              </p>
            </div>

            <Card className="p-6 bg-accent/30">
              <p className="text-sm text-muted-foreground mb-4">
                Don't worry - your booking details have been saved. You can try again or contact us for assistance.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <Button onClick={() => navigate("/book")}>
                  Try Again
                </Button>
                <Button variant="outline" onClick={() => navigate("/")}>
                  Return Home
                </Button>
              </div>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  // Payment successful
  if (booking) {
    const eventDate = new Date(booking.event_date);
    const balanceDueDate = addDays(eventDate, -15);
    const isDepositPaid = booking.payment_status === "deposit_paid";

    return (
      <div className="min-h-screen bg-gradient-to-b from-background to-accent/10">
        <Navigation />
        <div className="container mx-auto px-4 py-12 md:py-20">
          <div className="max-w-3xl mx-auto space-y-8">
            {/* Success Header */}
            <div className="text-center space-y-4">
              <div className="flex justify-center">
                <CheckCircle2 className="h-20 w-20 text-green-500" />
              </div>
              <h1 className="text-3xl md:text-4xl font-bold">
                {isDepositPaid ? "Payment Successful!" : "Booking Submitted!"}
              </h1>
              <p className="text-lg text-muted-foreground">
                Your booking is pending confirmation
              </p>
            </div>

            {/* Reservation Number Card */}
            <Card className="p-6 bg-primary/5 border-primary/20">
              <div className="text-center space-y-3">
                <p className="text-sm font-medium text-muted-foreground">Your Reservation Number</p>
                <div className="flex items-center justify-center gap-3">
                  <span className="text-3xl md:text-4xl font-mono font-bold tracking-wider">
                    {booking.reservation_number || "Pending..."}
                  </span>
                  {booking.reservation_number && (
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      onClick={copyReservationNumber}
                      className="h-10 w-10"
                    >
                      {copied ? (
                        <Check className="h-5 w-5 text-green-500" />
                      ) : (
                        <Copy className="h-5 w-5" />
                      )}
                    </Button>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  Save this number for your records
                </p>
              </div>
            </Card>

            {/* Booking Details */}
            <Card className="p-6">
              <h2 className="text-lg font-semibold mb-4">Booking Details</h2>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="flex items-center gap-3">
                  <Calendar className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm text-muted-foreground">Event Date</p>
                    <p className="font-medium">{format(eventDate, "EEEE, MMMM d, yyyy")}</p>
                  </div>
                </div>
                {booking.booking_type === "hourly" && booking.start_time && booking.end_time && (
                  <div className="flex items-center gap-3">
                    <Clock className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="text-sm text-muted-foreground">Time</p>
                      <p className="font-medium">{booking.start_time} - {booking.end_time}</p>
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <Users className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm text-muted-foreground">Guests</p>
                    <p className="font-medium">{booking.number_of_guests} guests</p>
                  </div>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Event Type</p>
                  <p className="font-medium capitalize">{booking.event_type.replace(/_/g, " ")}</p>
                </div>
              </div>
            </Card>

            {/* Payment Summary */}
            <Card className="p-6 bg-accent/30">
              <h2 className="text-lg font-semibold mb-4">Payment Summary</h2>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Total Booking Cost</span>
                  <span className="font-medium">${booking.total_amount.toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center text-green-600">
                  <span>Deposit Paid (50%)</span>
                  <span className="font-bold">${booking.deposit_amount.toFixed(2)}</span>
                </div>
                <div className="border-t pt-3">
                  <div className="flex justify-between items-center">
                    <div>
                      <span className="font-medium">Remaining Balance</span>
                      <p className="text-sm text-muted-foreground">
                        Due by {format(balanceDueDate, "MMMM d, yyyy")}
                      </p>
                    </div>
                    <span className="text-xl font-bold">${booking.balance_amount.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            </Card>

            {/* What's Next */}
            <Card className="p-6">
              <h2 className="text-lg font-semibold mb-4">What's Next?</h2>
              <ul className="space-y-3 text-sm">
                <li className="flex items-start gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-medium">1</span>
                  <span>You'll receive a confirmation email at <strong>{booking.email}</strong> within 24 hours</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-medium">2</span>
                  <span>Please hold off on sending invites until your booking is confirmed</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-medium">3</span>
                  <span>Your balance of <strong>${booking.balance_amount.toFixed(2)}</strong> will be charged on <strong>{format(balanceDueDate, "MMMM d, yyyy")}</strong></span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-medium">4</span>
                  <span>Access instructions will be sent 72 hours before your event</span>
                </li>
              </ul>
            </Card>

            {/* Actions */}
            <div className="flex justify-center">
              <Button size="lg" onClick={() => navigate("/")}>
                Return to Home
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
};

export default BookingConfirmation;
