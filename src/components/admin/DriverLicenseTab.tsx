import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ExternalLink, FileText, IdCard, PenLine, ShieldAlert } from "lucide-react";
import { LICENSE_BUCKET } from "@/lib/licenseUpload";

/**
 * Signature + driver's license the guest submitted at the signature step.
 * Files live in the PRIVATE `driver-licenses` bucket; only admins have a SELECT
 * policy, so we mint short-lived signed URLs on view instead of storing links.
 */
const SIGNED_URL_TTL_SECONDS = 60 * 10;

interface Props {
  booking: {
    id: string;
    signer_name?: string | null;
    initials?: string | null;
    signature?: string | null;
    signature_date?: string | null;
  };
}

type Registry = { front: string | null; back: string | null; retainUntil: string | null };

// Read from driver_license_uploads, not bookings.license_*_path: bookings has no
// RLS, so those columns are guest-editable. The registry is attached by trigger.
function useLicenseRegistry(bookingId: string) {
  const [state, setState] = useState<{ loading: boolean; error: string | null; data: Registry }>({
    loading: true,
    error: null,
    data: { front: null, back: null, retainUntil: null },
  });

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("driver_license_uploads" as any)
      .select("path, side, attached_at, retain_until")
      .eq("booking_id", bookingId)
      .order("attached_at", { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setState({ loading: false, error: error.message, data: { front: null, back: null, retainUntil: null } });
          return;
        }
        const rows = (data ?? []) as unknown as { path: string; side: string; retain_until: string | null }[];
        setState({
          loading: false,
          error: null,
          data: {
            front: rows.find((r) => r.side === "front")?.path ?? null,
            back: rows.find((r) => r.side === "back")?.path ?? null,
            retainUntil: rows[0]?.retain_until ?? null,
          },
        });
      });
    return () => {
      cancelled = true;
    };
  }, [bookingId]);

  return state;
}

function LicenseSide({ label, path }: { label: string; path: string | null | undefined }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setUrl(null);
    setError(null);
    if (!path) return;
    let cancelled = false;
    supabase.storage
      .from(LICENSE_BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data?.signedUrl) setError(error?.message || "Could not load file");
        else setUrl(data.signedUrl);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  const isPdf = path?.toLowerCase().endsWith(".pdf");

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{label}</p>
      {!path ? (
        <div className="flex h-40 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
          Not provided
        </div>
      ) : error ? (
        <div className="flex h-40 items-center justify-center gap-2 rounded-lg border border-destructive/40 text-sm text-destructive">
          <ShieldAlert className="h-4 w-4" /> {error}
        </div>
      ) : !url ? (
        <div className="h-40 animate-pulse rounded-lg bg-muted" />
      ) : isPdf ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-40 flex-col items-center justify-center gap-2 rounded-lg border hover:bg-muted/40"
        >
          <FileText className="h-8 w-8 text-muted-foreground" />
          <span className="text-sm text-primary underline">Open PDF</span>
        </a>
      ) : (
        <a href={url} target="_blank" rel="noopener noreferrer" className="block">
          <img src={url} alt={label} className="max-h-72 w-full rounded-lg border object-contain bg-muted/30" />
        </a>
      )}
      {url && (
        <Button variant="outline" size="sm" asChild>
          <a href={url} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="mr-2 h-4 w-4" /> Open full size
          </a>
        </Button>
      )}
    </div>
  );
}

export default function DriverLicenseTab({ booking }: Props) {
  const hasSignatureImage = booking.signature?.startsWith("data:image");
  const registry = useLicenseRegistry(booking.id);

  return (
    <div className="space-y-4">
      <Card className="border-l-4 border-l-indigo-500">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <PenLine className="h-5 w-5 text-indigo-500" />
            Signature
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-3">
            <div>
              <p className="text-muted-foreground">Signer name</p>
              <p className="font-medium">{booking.signer_name || "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Initials</p>
              <p className="font-medium">{booking.initials || "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Signed on</p>
              <p className="font-medium">{booking.signature_date || "—"}</p>
            </div>
          </div>
          {hasSignatureImage ? (
            <img
              src={booking.signature!}
              alt="Guest signature"
              className="max-h-48 w-full max-w-lg rounded-lg border bg-white object-contain"
            />
          ) : (
            <p className="text-sm text-muted-foreground">No drawn signature on file.</p>
          )}
        </CardContent>
      </Card>

      <Card className="border-l-4 border-l-emerald-500">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <IdCard className="h-5 w-5 text-emerald-500" />
            Driver's License
          </CardTitle>
        </CardHeader>
        <CardContent>
          {registry.loading ? (
            <div className="h-40 animate-pulse rounded-lg bg-muted" />
          ) : registry.error ? (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <ShieldAlert className="h-4 w-4" /> {registry.error}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <LicenseSide label="Front" path={registry.data.front} />
              <LicenseSide label="Back" path={registry.data.back} />
            </div>
          )}
          <p className="mt-4 text-xs text-muted-foreground">
            Links expire after 10 minutes.
            {registry.data.retainUntil && ` Files are deleted automatically on ${registry.data.retainUntil} (30 days after the event).`}{" "}
            Bookings made before this step existed, or created from the admin wizards, have no license on file.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
