import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { KeyRound, Loader2, ShieldCheck } from "lucide-react";

interface AccessCodeResult {
  code: string;
  label: string | null;
  full_name: string;
  event_date: string;
}

const AccessCode = () => {
  const [reservation, setReservation] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AccessCodeResult | null>(null);

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResult(null);

    const trimmed = reservation.trim();
    if (!trimmed) {
      setError("Please enter your reservation number.");
      return;
    }

    setLoading(true);
    try {
      const { data, error: rpcError } = await supabase.rpc(
        "get_access_code_for_reservation" as never,
        { p_reservation_number: trimmed } as never,
      );

      if (rpcError) {
        const msg = rpcError.message || "";
        if (msg.includes("reservation_not_found")) {
          setError("We couldn't find a reservation with that number. Please double-check and try again.");
        } else if (msg.includes("reservation_inactive")) {
          setError("This reservation is no longer active. Please contact us if you believe this is an error.");
        } else if (msg.includes("reservation_number_required")) {
          setError("Please enter your reservation number.");
        } else {
          setError("Something went wrong. Please try again or contact us.");
        }
        return;
      }

      const row = Array.isArray(data) ? data[0] : data;
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

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
            <KeyRound className="w-6 h-6 text-primary" />
          </div>
          <CardTitle className="text-2xl">Venue Access Code</CardTitle>
          <CardDescription>
            Enter your reservation number to view the current lockbox code for Orlando Event Venue.
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
                  required
                />
                <p className="text-xs text-muted-foreground">
                  You can find your reservation number in your confirmation email.
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

              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  setResult(null);
                  setReservation("");
                }}
              >
                Look up another reservation
              </Button>
            </div>
          )}

          <div className="pt-4 border-t text-center text-xs text-muted-foreground">
            Need help? Contact Luis Torres at <a href="tel:+14072763234" className="underline">(407) 276-3234</a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default AccessCode;
