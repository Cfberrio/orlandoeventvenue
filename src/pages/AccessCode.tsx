import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { KeyRound, Loader2, ShieldCheck, CheckCircle2 } from "lucide-react";
import GuestReportForm, { GuestReportFormBooking } from "@/components/access-code/GuestReportForm";

interface AccessCodeResult {
  code: string;
  label: string | null;
  booking_id: string;
  reservation_number: string;
  full_name: string;
  email: string;
  phone: string | null;
  event_date: string;
  end_time: string | null;
  event_type: string;
  host_report_step: string | null;
}

function computeEventEndDate(eventDate: string, endTime: string | null): Date {
  const time = endTime || "23:59:00";
  return new Date(`${eventDate}T${time}`);
}

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
        } else if (msg.includes("reservation_number_or_email_required")) {
          setError("Please enter your reservation number or email address.");
        } else {
          setError("Something went wrong. Please try again or contact us.");
        }
        return;
      }

      const row = data ? (Array.isArray(data) ? data[0] : data) : null;
      if (!row) {
        setError("No active access code found. Please contact us.");
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
            <h2 className="text-xl font-semibold mb-2">Report Submitted!</h2>
            <p className="text-muted-foreground mb-4">
              Thank you for submitting your post-event report. Our team will review it shortly.
            </p>
            <p className="text-muted-foreground text-sm mb-6">
              ¡Gracias por enviar tu reporte post-evento! Nuestro equipo lo revisará pronto.
            </p>
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
              We received your post-event report for reservation <strong>{result.reservation_number}</strong>. Thank you.
            </p>
            <p className="text-muted-foreground text-sm mb-6">
              Ya recibimos tu reporte post-evento. Gracias.
            </p>
            <Button variant="outline" className="w-full" onClick={resetLookup}>
              Look up another reservation
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Post-event: show guest report form
  if (result) {
    const eventEnd = computeEventEndDate(result.event_date, result.end_time);
    const now = new Date();
    if (now >= eventEnd) {
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
          <GuestReportForm booking={formBooking} onSubmitted={() => setReportSubmitted(true)} />
          <div className="max-w-2xl mx-auto mt-6 text-center">
            <Button variant="ghost" size="sm" onClick={resetLookup}>
              Look up another reservation
            </Button>
          </div>
        </div>
      );
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
            <KeyRound className="w-6 h-6 text-primary" />
          </div>
          <CardTitle className="text-2xl">Venue Access Code</CardTitle>
          <CardDescription>
            Enter your reservation number or the email used to book to view the current lockbox code.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {!result ? (
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
                  "Get Access Code"
                )}
              </Button>
            </form>
          ) : (
            <div className="space-y-5">
              <div className="rounded-lg border bg-muted/30 p-4 space-y-1 text-sm">
                <p><span className="text-muted-foreground">Guest:</span> <strong>{result.full_name}</strong></p>
                <p><span className="text-muted-foreground">Event Date:</span> <strong>{new Date(result.event_date + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</strong></p>
              </div>

              <div className="rounded-xl border-2 border-primary/20 bg-primary/5 p-6 text-center space-y-2">
                <div className="flex items-center justify-center gap-2 text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                  <ShieldCheck className="w-4 h-4" />
                  {result.label || "Lockbox Code"}
                </div>
                <div className="text-4xl font-mono font-bold tracking-widest text-primary select-all">
                  {result.code}
                </div>
              </div>

              <Alert>
                <AlertDescription className="text-xs leading-relaxed">
                  Touch the lockbox keypad screen to activate it, enter the code above, then retrieve the magnetic key.
                  Please keep this code confidential and do not share it.
                </AlertDescription>
              </Alert>

              <Button variant="outline" className="w-full" onClick={resetLookup}>
                Look up another reservation
              </Button>
            </div>
          )}

          <div className="pt-4 border-t text-center text-xs text-muted-foreground">
            Need help? Contact Luis Torres at <a href="tel:+14079745979" className="underline">407-974-5979</a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default AccessCode;
