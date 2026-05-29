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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Gift, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { EMAIL_REGEX, formatPhoneNumber, isValidPhone } from "@/lib/utils";

const POPUP_DELAY_MS = 5000;
const LOCAL_STORAGE_KEY = "popup_discount_shown";
const COUPON_CODE = "HOST100";

export default function DiscountPopup() {
  const [isOpen, setIsOpen] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [eventType, setEventType] = useState("");
  const [consent, setConsent] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; phone?: string }>({});
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

    const errors: { email?: string; phone?: string } = {};

    if (!email.trim() || !EMAIL_REGEX.test(email.trim())) {
      errors.email = "Please enter a valid email address";
    }

    if (!phone.trim() || !isValidPhone(phone)) {
      errors.phone = "Please enter a valid US phone number (10 digits)";
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setFieldErrors({});

    if (!fullName.trim()) {
      toast({ title: "Please enter your name", variant: "destructive" });
      return;
    }

    setSubmitting(true);

    try {
      const { error: insertError } = await supabase.
      from("popup_leads" as any).
      insert({
        full_name: fullName.trim(),
        email: email.trim().toLowerCase(),
        event_type: eventType || null,
        coupon_code: COUPON_CODE
      });

      // Handle unique constraint violation (duplicate email).
      // Decision: still sync to GHL so tags stay current, but do NOT
      // re-send email #1 to avoid spamming the returning visitor.
      if (insertError) {
        const pgCode = (insertError as any)?.code;
        if (pgCode === "23505") {
          toast({ title: "You're already on the list! Check your email for your credit code." });
          supabase.functions
            .invoke("send-popup-lead", {
              body: {
                fullName: fullName.trim(),
                email: email.trim().toLowerCase(),
                phone: phone.trim(),
                eventType: eventType || null,
              },
            })
            .then(({ error }) => {
              if (error) console.error("GHL popup lead error:", error);
            });
          setSubmitted(true);
          localStorage.setItem(LOCAL_STORAGE_KEY, "true");
          return;
        }
        console.error("Error saving lead:", insertError);
        toast({ title: "Something went wrong. Please try again.", variant: "destructive" });
        return;
      }

      // Send to GHL with tag "popup" (fire-and-forget)
      supabase.functions
        .invoke("send-popup-lead", {
          body: {
            fullName: fullName.trim(),
            email: email.trim().toLowerCase(),
            phone: phone.trim(),
            eventType: eventType || null,
          },
        })
        .then(({ error }) => {
          if (error) console.error("GHL popup lead error:", error);
        });

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
                Get $100 Off Your Event at Orlando Event Venue
              </DialogTitle>
              <DialogDescription className="text-center text-base">
                Apply it when you reserve any open date. We'll text + email your code in 60 seconds.
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
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (fieldErrors.email) setFieldErrors((prev) => ({ ...prev, email: undefined }));
                }}
                disabled={submitting}
                className={fieldErrors.email ? "border-destructive" : ""} />
                {fieldErrors.email && (
                  <p className="text-sm text-destructive">{fieldErrors.email}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="popup-phone">Phone (so we can text your code)</Label>
                <Input
                id="popup-phone"
                type="tel"
                placeholder="(407) 123-4567"
                value={phone}
                onChange={(e) => {
                  setPhone(formatPhoneNumber(e.target.value));
                  if (fieldErrors.phone) setFieldErrors((prev) => ({ ...prev, phone: undefined }));
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
                <Label htmlFor="popup-event-type">What kind of event?</Label>
                <Select
                  value={eventType}
                  onValueChange={setEventType}
                  disabled={submitting}
                >
                  <SelectTrigger id="popup-event-type">
                    <SelectValue placeholder="Select event type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Corporate">Corporate</SelectItem>
                    <SelectItem value="Workshop">Workshop</SelectItem>
                    <SelectItem value="Birthday or Celebration">Birthday or Celebration</SelectItem>
                    <SelectItem value="Non-Profit Gathering">Non-Profit Gathering</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
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

              "Send My $100"
              }
              </Button>
            </form>
          </> :

        <div className="text-center py-6 space-y-4">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-500/10">
              <CheckCircle2 className="h-7 w-7 text-green-500" />
            </div>
            <h3 className="text-xl font-bold">
              Your $100 is on its way.
            </h3>
            <p className="text-muted-foreground">
              Check your email + text in the next 60 seconds.
            </p>
            <div className="space-y-2 text-sm text-foreground text-left mt-4">
              <p>
                <strong>Already know your date?</strong> Book it now — open dates aren't held until 50% is in.
              </p>
              <p>
                <strong>Want to see the space first?</strong> Book your tour online.
              </p>
            </div>
            <p className="text-sm text-muted-foreground mt-4">
              Questions? Call or text 407-974-5979.
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