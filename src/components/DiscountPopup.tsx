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
import { Loader2, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { EMAIL_REGEX, formatPhoneNumber, isValidPhone } from "@/lib/utils";

const POPUP_DELAY_MS = 5000;
// New key so visitors who dismissed the old $100 popup still see the kit offer once.
const LOCAL_STORAGE_KEY = "popup_kit_shown";
const COUPON_CODE = "PLAN50";
const CONSENT_TEXT =
  "I agree to receive booking-related and promotional SMS & emails from Orlando Event Venue. Msg & data rates may apply. Reply STOP to opt out.";

type FieldErrors = {
  firstName?: string;
  email?: string;
  phone?: string;
  eventDate?: string;
};

export default function DiscountPopup() {
  const [isOpen, setIsOpen] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [consent, setConsent] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const { toast } = useToast();

  const todayISO = new Date().toISOString().split("T")[0];

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

  const clearFieldError = (field: keyof FieldErrors) => {
    setFieldErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const errors: FieldErrors = {};

    if (!firstName.trim()) {
      errors.firstName = "Enter your first name.";
    }

    if (!email.trim() || !EMAIL_REGEX.test(email.trim())) {
      errors.email = "Enter a valid email address.";
    }

    if (!phone.trim() || !isValidPhone(phone)) {
      errors.phone = "Enter a valid mobile phone number.";
    }

    if (!eventDate) {
      errors.eventDate = "Select your event date.";
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setFieldErrors({});
    setSubmitting(true);

    const syncToGhl = () => {
      supabase.functions
        .invoke("send-popup-lead", {
          body: {
            fullName: firstName.trim(),
            email: email.trim().toLowerCase(),
            phone: phone.trim(),
            eventDate,
          },
        })
        .then(({ error }) => {
          if (error) console.error("GHL popup lead error:", error);
        });
    };

    try {
      const { error: insertError } = await supabase.
      from("popup_leads" as any).
      insert({
        full_name: firstName.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim(),
        preferred_event_date: eventDate,
        coupon_code: COUPON_CODE,
        consent_given: true,
        consent_text: CONSENT_TEXT,
        lead_source: "website_popup"
      });

      // Handle unique constraint violation (duplicate email).
      // Decision: still sync to GHL so the contact stays current, but do NOT
      // re-send email #1 or restart the sequence for a returning visitor.
      if (insertError) {
        const pgCode = (insertError as any)?.code;
        if (pgCode === "23505") {
          toast({ title: "You're already on the list! Check your email for your Event Planning Kit and $50 OFF code." });
          syncToGhl();
          setSubmitted(true);
          localStorage.setItem(LOCAL_STORAGE_KEY, "true");
          return;
        }
        console.error("Error saving lead:", insertError);
        toast({
          title: "We could not submit your information.",
          description: "Check the fields above and try again. If it still does not work, call or text 407 974 5979.",
          variant: "destructive"
        });
        return;
      }

      // Send to GHL with tag "popup" (fire-and-forget)
      syncToGhl();

      // Send Email 1 immediately (fire-and-forget, don't block the UI)
      supabase.functions.
      invoke("send-discount-email", {
        body: {
          full_name: firstName.trim(),
          email: email.trim().toLowerCase(),
          coupon_code: COUPON_CODE,
          email_number: 1
        }
      }).
      then(({ error: emailError }) => {
        if (emailError) {
          console.error("Error sending kit email #1:", emailError);
        }
      });

      setSubmitted(true);
      localStorage.setItem(LOCAL_STORAGE_KEY, "true");
    } catch (error) {
      console.error("Kit popup submit error:", error);
      toast({
        title: "We could not submit your information.",
        description: "Check the fields above and try again. If it still does not work, call or text 407 974 5979.",
        variant: "destructive"
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md bg-card border-border max-h-[90vh] overflow-y-auto">
        {!submitted ?
        <>
            <DialogHeader className="text-center space-y-2">
              <DialogTitle className="text-2xl font-bold text-center leading-tight">
                🆓 Free Event Planning Kit
                <span className="block text-primary">💰 $50 OFF Your Booking</span>
              </DialogTitle>
              <DialogDescription className="text-center text-base">
                Get the complete checklist for planning your event in our space. We'll email and text it to you with your $50 OFF code.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleSubmit} className="space-y-4 mt-2">
              <div className="space-y-2">
                <Label htmlFor="popup-first-name">First name</Label>
                <Input
                id="popup-first-name"
                placeholder="First name"
                value={firstName}
                onChange={(e) => {
                  setFirstName(e.target.value);
                  clearFieldError("firstName");
                }}
                disabled={submitting}
                className={fieldErrors.firstName ? "border-destructive" : ""} />
                {fieldErrors.firstName && (
                  <p className="text-sm text-destructive">{fieldErrors.firstName}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="popup-email">Email address</Label>
                <Input
                id="popup-email"
                type="email"
                placeholder="Email address"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  clearFieldError("email");
                }}
                disabled={submitting}
                className={fieldErrors.email ? "border-destructive" : ""} />
                {fieldErrors.email && (
                  <p className="text-sm text-destructive">{fieldErrors.email}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="popup-phone">Mobile phone</Label>
                <Input
                id="popup-phone"
                type="tel"
                placeholder="Mobile phone"
                value={phone}
                onChange={(e) => {
                  setPhone(formatPhoneNumber(e.target.value));
                  clearFieldError("phone");
                }}
                maxLength={14}
                inputMode="numeric"
                disabled={submitting}
                className={fieldErrors.phone ? "border-destructive" : ""} />
                {fieldErrors.phone && (
                  <p className="text-sm text-destructive">{fieldErrors.phone}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="popup-event-date">What date are you planning for?</Label>
                <Input
                id="popup-event-date"
                type="date"
                min={todayISO}
                value={eventDate}
                onChange={(e) => {
                  setEventDate(e.target.value);
                  clearFieldError("eventDate");
                }}
                disabled={submitting}
                className={fieldErrors.eventDate ? "border-destructive" : ""} />
                {fieldErrors.eventDate && (
                  <p className="text-sm text-destructive">{fieldErrors.eventDate}</p>
                )}
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
                  {CONSENT_TEXT} <span className="text-destructive">*</span>
                </Label>
              </div>

              <Button type="submit" className="w-full" size="lg" disabled={submitting || !consent}>
                {submitting ?
              <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Sending...
                  </> :

              "Send My Kit + $50 OFF"
              }
              </Button>
            </form>
          </> :

        <div className="text-center py-6 space-y-4">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-500/10">
              <CheckCircle2 className="h-7 w-7 text-green-500" />
            </div>
            <h3 className="text-xl font-bold">
              Your Event Planning Kit + $50 OFF Are on the Way
            </h3>
            <p className="text-muted-foreground">
              Check your email and text for your Event Planning Kit and your code for $50 OFF your venue rental.
            </p>
            <p className="text-sm text-foreground">
              <strong>Already know your date?</strong> Only 50% of total is needed to book.
            </p>
            <div className="flex flex-col gap-2 mt-4">
              <Button asChild size="lg">
                <a href="/book">Begin Your Booking</a>
              </Button>
              <Button asChild variant="outline">
                <a href="/schedule-tour">Book a Tour</a>
              </Button>
            </div>
            <p className="text-sm text-muted-foreground mt-4">
              Questions or did not receive the kit? Call or text 407 974 5979.
            </p>
          </div>
        }
      </DialogContent>
    </Dialog>);

}
