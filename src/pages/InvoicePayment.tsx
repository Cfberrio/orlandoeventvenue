import { useNavigate } from "react-router-dom";
import Navigation from "@/components/Navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle } from "lucide-react";

interface InvoicePaymentProps {
  cancelled?: boolean;
}

// Landing pages for standalone invoice Stripe checkouts
// (create-invoice success_url -> /invoice-paid, cancel_url -> /invoice-cancelled).
// Standalone invoices aren't tied to a booking and the invoices table isn't
// publicly readable, so these pages are intentionally static.
const InvoicePayment = ({ cancelled = false }: InvoicePaymentProps) => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-accent/10">
      <Navigation />
      <div className="container mx-auto px-4 py-20">
        <div className="max-w-2xl mx-auto text-center space-y-6">
          <div className="flex justify-center">
            {cancelled ? (
              <XCircle className="h-20 w-20 text-destructive" />
            ) : (
              <CheckCircle2 className="h-20 w-20 text-green-500" />
            )}
          </div>

          <div>
            <h1 className="text-3xl font-bold mb-2">
              {cancelled ? "Payment Cancelled" : "Payment Received!"}
            </h1>
            <p className="text-lg text-muted-foreground">
              {cancelled
                ? "Your payment was cancelled. No charges were made."
                : "Thank you! Your invoice has been paid."}
            </p>
          </div>

          <Card className="p-6 bg-accent/30">
            <p className="text-sm text-muted-foreground mb-4">
              {cancelled
                ? "To try again, reopen the payment link from your email. If the link has expired, contact us and we'll send you a fresh one."
                : "A receipt will be emailed to you shortly. If anything looks off, just reply to the invoice email and we'll take care of it."}
            </p>
            <p className="text-sm text-muted-foreground mb-4">
              (407) 974-5979 &middot; Orlandoeventvenue@gmail.com
            </p>
            <div className="flex justify-center">
              <Button variant={cancelled ? "outline" : "default"} onClick={() => navigate("/")}>
                Return Home
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default InvoicePayment;
