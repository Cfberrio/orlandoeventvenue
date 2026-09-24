import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { FileText, IdCard, Search, ShieldAlert } from "lucide-react";
import { LICENSE_BUCKET } from "@/lib/licenseUpload";

/**
 * Every driver's license attached to a booking, newest first. Reads the
 * driver_license_uploads registry (admin-only RLS), never bookings.license_*_path,
 * which guests can edit. Thumbnails are 10-minute signed URLs.
 */
const SIGNED_URL_TTL_SECONDS = 60 * 10;

interface Row {
  path: string;
  side: string;
  attached_at: string | null;
  retain_until: string | null;
  booking_id: string;
  bookings: {
    reservation_number: string | null;
    full_name: string | null;
    email: string | null;
    event_date: string | null;
    status: string | null;
  } | null;
}

export default function DriverLicenses() {
  const [rows, setRows] = useState<Row[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("driver_license_uploads" as any)
        .select("path, side, attached_at, retain_until, booking_id, bookings(reservation_number, full_name, email, event_date, status)")
        .not("booking_id", "is", null)
        .is("deleting_at", null)
        .order("attached_at", { ascending: false })
        .limit(500);
      if (cancelled) return;
      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }
      const list = (data ?? []) as unknown as Row[];
      setRows(list);
      setLoading(false);

      const images = list.filter((r) => !r.path.endsWith(".pdf")).map((r) => r.path);
      if (images.length) {
        const { data: signed, error: signError } = await supabase.storage
          .from(LICENSE_BUCKET)
          .createSignedUrls(images, SIGNED_URL_TTL_SECONDS);
        if (cancelled) return;
        if (signError) {
          console.error("createSignedUrls failed:", signError);
          return;
        }
        const map: Record<string, string> = {};
        signed?.forEach((s) => {
          if (s.path && s.signedUrl) map[s.path] = s.signedUrl;
        });
        setUrls(map);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.bookings?.full_name, r.bookings?.email, r.bookings?.reservation_number]
        .some((v) => v?.toLowerCase().includes(q)),
    );
  }, [rows, query]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <IdCard className="h-6 w-6" /> Driver's Licenses
        </h1>
        <p className="text-sm text-muted-foreground">
          Licenses guests submitted at checkout. Each one is deleted automatically 30 days after the event.
        </p>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search name, email, or reservation #"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => <div key={i} className="h-64 animate-pulse rounded-lg bg-muted" />)}
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 text-sm text-destructive">
          <ShieldAlert className="h-4 w-4" /> {error}
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {rows.length === 0 ? "No licenses on file yet." : "No licenses match your search."}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((r) => (
            <Link key={r.path} to={`/admin/bookings/${r.booking_id}?tab=license`} className="block">
              <Card className="h-full overflow-hidden transition-shadow hover:shadow-md">
                <div className="flex h-40 items-center justify-center bg-muted/40">
                  {r.path.endsWith(".pdf") ? (
                    <FileText className="h-10 w-10 text-muted-foreground" />
                  ) : urls[r.path] ? (
                    <img src={urls[r.path]} alt={`License of ${r.bookings?.full_name ?? "guest"}`} className="h-full w-full object-contain" />
                  ) : (
                    <div className="h-full w-full animate-pulse bg-muted" />
                  )}
                </div>
                <CardContent className="space-y-1 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate font-medium">{r.bookings?.full_name || "—"}</p>
                    {r.side === "back" && <Badge variant="secondary">Back</Badge>}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">{r.bookings?.email}</p>
                  <p className="text-xs text-muted-foreground">
                    <span className="font-mono">{r.bookings?.reservation_number}</span>
                    {r.bookings?.event_date && ` · Event ${r.bookings.event_date}`}
                  </p>
                  {r.retain_until && (
                    <p className="text-xs text-muted-foreground">Deletes on {r.retain_until}</p>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
