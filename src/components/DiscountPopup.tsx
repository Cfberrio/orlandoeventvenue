import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription } from
"@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Gift, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

const POPUP_DELAY_MS = 5000;
const LOCAL_STORAGE_KEY = "popup_discount_shown";
const COUPON_CODE = "SAVE50";

export default function DiscountPopup() {
  const [isOpen, setIsOpen] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [preferredDate, setPreferredDate] = useState("");
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const alreadyShown = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (alreadyShown) return;

    const timer = setTimeout(() => {
      setIsOpen(true);
    }, POPUP_DELAY_MS);

    return () => clearTimeout(timer);
  }, []);

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (!open) {
      localStorage.setItem(LOCAL_STORAGE_KEY, "true");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!fullName.trim() || !email.trim() || !phone.trim()) {
      toast({ title: "Please fill in all required fields", variant: "destructive" });
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      toast({ title: "Please enter a valid email address", variant: "destructive" });
      return;
    }

    const phoneDigits = phone.replace(/\D/g, "");
    if (phoneDigits.length !== 10 && !(phoneDigits.length === 11 && phoneDigits.startsWith("1"))) {
      toast({ title: "Please enter a valid US phone number (10 digits)", variant: "destructive" });
      return;
    }

    setSubmitting(true);

    try {
      const { error: insertError } = await supabase.
      from("popup_leads" as any).
      insert({
        full_name: fullName.trim(),
        email: email.trim().toLowerCase(),
        preferred_event_date: preferredDate || null,
        coupon_code: COUPON_CODE
      });

      if (insertError) {
        console.error("Error saving lead:", insertError);
        toast({ title: "Something went wrong. Please try again.", variant: "destructive" });
        return;
      }

      // Send Email 1 immediately (fire-and-forget, don't block the UI)
      supabase.functions.
      invoke("send-discount-email", {
        body: {
          full_name: fullName.trim(),
          email: email.trim().toLowerCase(),
          coupon_code: COUPON_CODE,
          email_number: 1
        }
      }).
      then(({ error: emailError }) => {
        if (emailError) {
          console.error("Error sending discount email #1:", emailError);
        }
      });

      setSubmitted(true);
      localStorage.setItem(LOCAL_STORAGE_KEY, "true");
    } catch (error) {
      console.error("Discount popup submit error:", error);
      toast({ title: "Something went wrong. Please try again.", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md bg-card border-border">
        {!submitted ?
        <>
            <DialogHeader className="text-center space-y-3">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                <Gift className="h-7 w-7 text-primary" />
              </div>
              <DialogTitle className="text-2xl font-bold text-center">
                Get $50 Off!
              </DialogTitle>
              <DialogDescription className="text-center text-base">
                Planning an event? Get $50 sent to your email now{"\n"}
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleSubmit} className="space-y-4 mt-2">
              <div className="space-y-2">
                <Label htmlFor="popup-name">Name</Label>
                <Input
                id="popup-name"
                placeholder="Your full name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                disabled={submitting} />

              </div>

              <div className="space-y-2">
                <Label htmlFor="popup-email">Email</Label>
                <Input
                id="popup-email"
                type="email"
                placeholder="your@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={submitting} />

              </div>

              <div className="space-y-2">
                <Label htmlFor="popup-date">Preferred Event Date</Label>
                <Input
                id="popup-date"
                type="date"
                value={preferredDate}
                onChange={(e) => setPreferredDate(e.target.value)}
                disabled={submitting} />

              </div>

              <div className="flex items-start space-x-2">
                <Checkbox
                  id="popup-consent"
                  checked={consent}
                  onCheckedChange={(checked) => setConsent(checked as boolean)}
                  className="mt-0.5"
                  required
                />
                <Label htmlFor="popup-consent" className="text-[11px] font-normal cursor-pointer leading-snug text-muted-foreground">
                  I agree to receive booking-related and promotional SMS & emails from Orlando Event Venue. Msg & data rates may apply. Reply STOP to opt out. <span className="text-destructive">*</span>
                </Label>
              </div>

              <Button type="submit" className="w-full" size="lg" disabled={submitting || !consent}>
                {submitting ?
              <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Sending...
                  </> :

              "Get My $50 Off"
              }
              </Button>
            </form>
          </> :

        <div className="text-center py-6 space-y-4">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-500/10">
              <CheckCircle2 className="h-7 w-7 text-green-500" />
            </div>
            <h3 className="text-xl font-bold">Check Your Email!</h3>
            <p className="text-muted-foreground">
              We've sent your <strong>$50 discount code</strong> to{" "}
              <strong>{email}</strong>.
            </p>
            <p className="text-sm text-muted-foreground mt-4">
              Check your inbox for your exclusive discount code. Don't forget to check your spam folder if you don't see it.
            </p>
            <Button
            onClick={() => handleOpenChange(false)}
            variant="outline"
            className="mt-4">

              Close
            </Button>
          </div>
        }
      </DialogContent>
    </Dialog>);

}