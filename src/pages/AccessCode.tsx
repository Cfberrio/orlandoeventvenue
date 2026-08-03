import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { KeyRound, Loader2, ShieldCheck, CheckCircle2, Clock, Lightbulb, Wifi, ExternalLink, DoorOpen } from "lucide-react";
import GuestReportForm, { GuestReportFormBooking } from "@/components/access-code/GuestReportForm";

interface AccessCodeResult {
  code: string | null;
  label: string | null;
  access_released?: boolean;
  booking_id: string;
  reservation_number: string;
  full_name: string;
  email: string;
  phone: string | null;
  event_date: string;
  start_time?: string | null;
  end_time: string | null;
  event_type: string;
  host_report_step: string | null;
  is_recurring?: boolean;
  expires_on?: string | null;
}

const GOOGLE_REVIEW_URL =
  "https://www.google.com/maps/place/Orlando+Event+Venue/@28.5546949,-81.3364816,17z/data=!3m1!4b1!4m6!3m5!1s0x88e7658349956c29:0x14dd97040d50b24f!8m2!3d28.5546949!4d-81.3364816!16s%2Fg%2F11wn71fmqr?entry=ttu&g_ep=EgoyMDI1MTIwOS4wIKXMDSoASAFQAw%3D%3D";

const VENUE_RULE_CATEGORIES = [
  "Capacity and Reservation Time",
  "Tables, Chairs, and Trash",
  "Alcohol, Drugs, and Smoking",
  "Catering and Kitchen Use",
  "Decorations and Venue Equipment",
  "Noise, Doors, and Pets",
];

function formatTime(time: string | null | undefined): string | null {
  if (!time) return null;
  const [h, m] = time.split(":");
  const hours = Number(h);
  if (Number.isNaN(hours)) return null;
  const suffix = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${m} ${suffix}`;
}

function formatEventType(eventType: string): string {
  return eventType
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

const ReservationDetails = ({ result }: { result: AccessCodeResult }) => {
  const start = formatTime(result.start_time);
  const end = formatTime(result.end_time);
  const timeRange = start && end ? `${start} – ${end}` : start || end || null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base uppercase tracking-wide">Reservation Details</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-1.5 text-sm">
          <p>
            <span className="text-muted-foreground">Reservation Number:</span>{" "}
            <strong>{result.reservation_number}</strong>
          </p>
          <p>
            <span className="text-muted-foreground">Guest:</span> <strong>{result.full_name}</strong>
          </p>
          <p>
            <span className="text-muted-foreground">Event Date:</span>{" "}
            <strong>
              {new Date(result.event_date + "T00:00:00").toLocaleDateString("en-US", {
                weekday: "long",
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </strong>
          </p>
          {timeRange && (
            <p>
              <span className="text-muted-foreground">Reservation Time:</span> <strong>{timeRange}</strong>
            </p>
          )}
          {result.event_type && (
            <p>
              <span className="text-muted-foreground">Event Type:</span>{" "}
              <strong>{formatEventType(result.event_type)}</strong>
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

const RecurringDetails = ({ result }: { result: AccessCodeResult }) => (
  <Card>
    <CardHeader>
      <CardTitle className="text-base uppercase tracking-wide">Recurring Access Details</CardTitle>
    </CardHeader>
    <CardContent>
      <div className="space-y-1.5 text-sm">
        <p>
          <span className="text-muted-foreground">Reservation Number:</span>{" "}
          <strong>{result.reservation_number}</strong>
        </p>
        <p>
          <span className="text-muted-foreground">Name:</span> <strong>{result.full_name}</strong>
        </p>
        {result.expires_on && (
          <p>
            <span className="text-muted-foreground">Access Valid Until:</span>{" "}
            <strong>
              {new Date(result.expires_on + "T00:00:00").toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </strong>
          </p>
        )}
      </div>
    </CardContent>
  </Card>
);

const HelpFooter = () => (
  <div className="pt-4 border-t text-center text-xs text-muted-foreground">
    Need help? Contact Luis Torres at{" "}
    <a href="tel:+14079745979" className="underline">
      407-974-5979
    </a>
  </div>
);

const AccessCode = () => {
  const [searchParams] = useSearchParams();
  const queryRes = searchParams.get("res") || searchParams.get("reservation") || "";
  const queryEmail = searchParams.get("email") || "";

  const [reservation, setReservation] = useState(queryRes.toUpperCase());
  const [email, setEmail] = useState(queryEmail);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AccessCodeResult | null>(null);
  const [reportSubmitted, setReportSubmitted] = useState(false);
  const autoLookupRan = useRef(false);

  const doLookup = async (resInput: string, emailInput: string) => {
    setError(null);
    setResult(null);
    setReportSubmitted(false);

    const trimmedRes = resInput.trim();
    const trimmedEmail = emailInput.trim();

    if (!trimmedRes && !trimmedEmail) {
      setError("Please enter your reservation number or email address.");
      return;
    }

    setLoading(true);
    try {
      const { data, error: rpcError } = await supabase.rpc(
        "get_access_code_for_reservation" as never,
        {
          p_reservation_number: trimmedRes || null,
          p_email: trimmedEmail || null,
        } as never,
      );

      if (rpcError) {
        const msg = rpcError.message || "";
        if (msg.includes("reservation_not_found")) {
          setError("We couldn't find a reservation matching that information. Please double-check and try again.");
        } else if (msg.includes("reservation_inactive")) {
          setError("This reservation is no longer active. Please contact us if you believe this is an error.");
        } else if (msg.includes("recurring_code_paused")) {
          setError("This access code is currently paused. Please contact us if you believe this is an error.");
        } else if (msg.includes("recurring_code_expired")) {
          setError("This access code has expired. Please contact us to renew your access.");
        } else if (msg.includes("access_code_locked_until_event_day")) {
          setError("Your venue access will be released one hour before your event begins. Please return to this page at that time.");
        } else if (msg.includes("reservation_number_or_email_required")) {
          setError("Please enter your reservation number or email address.");
        } else {
          setError("Something went wrong. Please try again or contact us.");
        }
        return;
      }

      const row = data ? (Array.isArray(data) ? data[0] : data) : null;
      if (!row) {
        setError("No active reservation found. Please contact us.");
        return;
      }
      setResult(row as AccessCodeResult);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (autoLookupRan.current) return;
    if (queryRes || queryEmail) {
      autoLookupRan.current = true;
      void doLookup(queryRes, queryEmail);
    }
  }, [queryRes, queryEmail]);

  const handleLookup = (e: React.FormEvent) => {
    e.preventDefault();
    void doLookup(reservation, email);
  };

  const resetLookup = () => {
    setResult(null);
    setReservation("");
    setEmail("");
    setError(null);
    setReportSubmitted(false);
  };

  // Submitted thank-you state
  if (result && reportSubmitted) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center">
            <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Guest Report Submitted!</h2>
            <p className="text-muted-foreground mb-4">
              Thank you! Your reservation is now complete. Our team will review your report shortly.
            </p>
            <p className="text-muted-foreground text-sm mb-6">
              ¡Gracias! Tu reservación está completa. Nuestro equipo revisará tu reporte pronto.
            </p>
            <a href={GOOGLE_REVIEW_URL} target="_blank" rel="noopener noreferrer" className="block mb-3">
              <Button className="w-full bg-blue-600 hover:bg-blue-700 text-white">
                <ExternalLink className="mr-2 h-4 w-4" />
                Leave a Google Review
              </Button>
            </a>
            <Button variant="outline" className="w-full" onClick={resetLookup}>
              Look up another reservation
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Already-submitted state (host_report_step === 'completed' from DB)
  if (result && result.host_report_step === "completed") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center">
            <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Report Already Submitted</h2>
            <p className="text-muted-foreground mb-4">
              We received your Guest Report for reservation <strong>{result.reservation_number}</strong>. Thank you.
            </p>
            <p className="text-muted-foreground text-sm mb-6">
              Ya recibimos tu Guest Report. Gracias.
            </p>
            <Button variant="outline" className="w-full" onClick={resetLookup}>
              Look up another reservation
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // STATE 1 — before access is available (server returns booking info but no code)
  if (result && !result.code) {
    return (
      <div className="min-h-screen bg-background py-8 px-4">
        <div className="max-w-2xl mx-auto space-y-6">
          <Card>
            <CardHeader className="text-center">
              <div className="mx-auto mb-3 w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                <Clock className="w-6 h-6 text-primary" />
              </div>
              <CardTitle className="text-2xl">Your Access Is Not Available Yet</CardTitle>
              <CardDescription className="text-base">
                Your venue access will be released one hour before your event begins. Please return
                to this page at that time and enter your reservation number again.
              </CardDescription>
            </CardHeader>
          </Card>

          <Alert>
            <AlertDescription>
              <strong>Important Reminder:</strong> Your reservation time includes setup, the event,
              breakdown, and the final venue check. Plan enough time to complete everything before
              your reservation ends.
            </AlertDescription>
          </Alert>

          <ReservationDetails result={result} />

          <Button variant="outline" className="w-full" onClick={resetLookup}>
            Look up another reservation
          </Button>
          <HelpFooter />
        </div>
      </div>
    );
  }

  // STATE 2 — access released: door code, instructions, guest report, rules, details
  if (result && result.code) {
    const isRecurring = !!result.is_recurring;
    const formBooking: GuestReportFormBooking = {
      id: result.booking_id,
      reservation_number: result.reservation_number,
      full_name: result.full_name,
      email: result.email,
      phone: result.phone,
      event_date: result.event_date,
    };
    return (
      <div className="min-h-screen bg-background py-8 px-4">
        <div className="max-w-2xl mx-auto space-y-6">
          <Card>
            <CardHeader className="text-center">
              <div className="mx-auto mb-3 w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                <KeyRound className="w-6 h-6 text-primary" />
              </div>
              <CardTitle className="text-2xl">Your Access Is Ready</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-xl border-2 border-primary/20 bg-primary/5 p-6 text-center space-y-2">
                <div className="flex items-center justify-center gap-2 text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                  <ShieldCheck className="w-4 h-4" />
                  {result.label || "Door Code"}
                </div>
                <div className="text-4xl font-mono font-bold tracking-widest text-primary select-all">
                  {result.code}
                </div>
              </div>
              <p className="text-sm text-center text-muted-foreground">
                Use this code on the black lockbox beside the entrance.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <DoorOpen className="w-5 h-5" />
                How to Enter the Venue
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm leading-relaxed">
              <div>
                <p className="font-semibold">1. Find the Entrance</p>
                <p className="text-muted-foreground">
                  Look for the GLOBAL sign with the number 3847. When facing the sign, use the door
                  on the left.
                </p>
              </div>
              <div>
                <p className="font-semibold">2. Open the Lockbox</p>
                <p className="text-muted-foreground">
                  Tap the black lockbox screen to wake it. Enter your door code:{" "}
                  <span className="font-mono font-bold text-foreground">{result.code}</span>. Open
                  the lockbox and remove the magnetic key.
                </p>
              </div>
              <div>
                <p className="font-semibold">3. Unlock the Door</p>
                <p className="text-muted-foreground">
                  Tap the magnetic key against the sensor located to the right of the door.
                </p>
              </div>
              <div>
                <p className="font-semibold">4. Return the Key</p>
                <p className="text-muted-foreground">
                  Immediately return the magnetic key to the lockbox and close it securely.{" "}
                  <strong className="text-foreground">Do not take the key inside the venue.</strong>
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Lightbulb className="w-5 h-5" />
                How to Turn On the Lights
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm leading-relaxed text-muted-foreground">
              <p>
                The white remote labeled <strong className="text-foreground">Light</strong> is
                located on the left wall.
              </p>
              <p>The buttons on the left turn the lights on. The buttons on the right turn the lights off.</p>
              <p>Return the remote to the same place before leaving.</p>
              <p>
                If the lights do not turn on, turn on the wall switch first. Then use the white
                remote.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Wifi className="w-5 h-5" />
                Wi-Fi Information
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-1">
              <p>
                <span className="text-muted-foreground">Network:</span>{" "}
                <strong className="font-mono">GlobalChurch</strong>
              </p>
              <p>
                <span className="text-muted-foreground">Password:</span>{" "}
                <strong className="font-mono">Orlandoministry</strong>
              </p>
            </CardContent>
          </Card>

          {!isRecurring && (
            <div className="pt-2">
              <h2 className="text-center text-sm font-semibold uppercase tracking-widest text-muted-foreground mb-4">
                Before Your Reservation Ends
              </h2>
              <GuestReportForm booking={formBooking} onSubmitted={() => setReportSubmitted(true)} />
            </div>
          )}

          {!isRecurring && (
          <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950/20 dark:to-indigo-950/20 border-2 border-blue-200 dark:border-blue-800">
            <CardHeader>
              <CardTitle className="text-lg">Enjoyed the Venue?</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm">
                A quick Google review helps future hosts find Orlando Event Venue.
              </p>
              <a href={GOOGLE_REVIEW_URL} target="_blank" rel="noopener noreferrer" className="block">
                <Button type="button" className="w-full bg-blue-600 hover:bg-blue-700 text-white">
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Leave a Google Review
                </Button>
              </a>
            </CardContent>
          </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base uppercase tracking-wide">Venue Rules</CardTitle>
              <CardDescription>
                These rules are displayed on the Event Page and confirmed during booking. Fees may be
                charged when a rule is violated.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {VENUE_RULE_CATEGORIES.map((title) => (
                <p key={title} className="text-sm font-semibold">
                  {title}
                </p>
              ))}
              {!isRecurring && (
                <div className="pt-2 border-t">
                  <p className="text-sm font-semibold mb-1">Final Venue Check</p>
                  <p className="text-sm text-muted-foreground">
                    A Guest Report is required after every event. It confirms that the venue was
                    restored, all guests left, and the entrance was locked. Cameras and noise sensors
                    monitor the venue. Serious violations may result in the event ending without a
                    refund.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {isRecurring ? <RecurringDetails result={result} /> : <ReservationDetails result={result} />}

          <Button variant="outline" className="w-full" onClick={resetLookup}>
            Look up another reservation
          </Button>
          <HelpFooter />
        </div>
      </div>
    );
  }

  // Default — lookup form
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
            <KeyRound className="w-6 h-6 text-primary" />
          </div>
          <CardTitle className="text-2xl">Orlando Event Venue Access</CardTitle>
          <CardDescription>
            Enter your reservation number. The page will display the correct information based on
            your event's current stage.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <form onSubmit={handleLookup} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="reservation">Reservation Number</Label>
              <Input
                id="reservation"
                type="text"
                placeholder="OEV-XXXXXX"
                value={reservation}
                onChange={(e) => setReservation(e.target.value.toUpperCase())}
                maxLength={20}
                autoComplete="off"
                disabled={loading}
              />
            </div>

            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <div className="flex-1 border-t" />
              <span>or</span>
              <div className="flex-1 border-t" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email Address</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                disabled={loading}
              />
              <p className="text-xs text-muted-foreground">
                Use the email address associated with your booking.
              </p>
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Looking up…
                </>
              ) : (
                "ENTER"
              )}
            </Button>
          </form>

          <HelpFooter />
        </CardContent>
      </Card>
    </div>
  );
};

export default AccessCode;
