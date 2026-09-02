import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertTriangle, DollarSign, Megaphone, MousePointerClick, Radio } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { format, parseISO } from "date-fns";
import { META_PIXEL_ID } from "@/lib/tracking/config";

/*
 * Ad attribution dashboard.
 *
 * Everything here reads the SQL views created by
 * supabase/migrations/20260902140100_meta_attribution_reporting.sql, which are
 * security_invoker and therefore admin-only through RLS.
 *
 * What this panel does NOT do: compute ROAS. This database owns bookings and
 * revenue; Meta Ads Manager owns spend. Pretending to know both here would
 * produce a confident number built on a guess.
 *
 * The views are not in the generated Supabase types (they are created by
 * migration, and src/integrations/supabase/types.ts is Lovable-generated), so
 * each query is cast — the same pattern the popup_leads queries already use.
 */

const money = (n: unknown) =>
  `$${Number(n ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

type ChannelRow = {
  channel: string;
  campaign: string;
  paid_bookings: number;
  contract_revenue: number;
  avg_contract_value: number;
};

type CreativeRow = {
  creative: string;
  meta_ad_id: string | null;
  paid_bookings: number;
  deposit_revenue: number;
  contract_revenue: number;
};

type GeoRow = {
  geo_adset: string;
  meta_adset_id: string | null;
  paid_bookings: number;
  contract_revenue: number;
};

type FunnelRow = {
  day: string;
  book_landing_views: number;
  booking_started: number;
  leads: number;
  bookings_created: number;
  checkouts_started: number;
  deposits_paid: number;
};

type DeliveryRow = {
  day: string;
  event_name: string;
  status: string;
  events: number;
};

function useAttribution() {
  return useQuery({
    queryKey: ["meta-attribution"],
    queryFn: async () => {
      const [channels, creatives, geos, funnel, delivery] = await Promise.all([
        supabase
          .from("v_channel_performance" as never)
          .select("*")
          .order("contract_revenue", { ascending: false })
          .limit(50),
        supabase
          .from("v_meta_creative_performance" as never)
          .select("*")
          .order("contract_revenue", { ascending: false })
          .limit(50),
        supabase
          .from("v_meta_geo_performance" as never)
          .select("*")
          .order("contract_revenue", { ascending: false })
          .limit(50),
        supabase
          .from("v_booking_funnel_daily" as never)
          .select("*")
          .order("day", { ascending: false })
          .limit(30),
        supabase
          .from("v_meta_delivery_health" as never)
          .select("*")
          .order("day", { ascending: false })
          .limit(120),
      ]);

      // A failing view is worth surfacing, not swallowing: it almost always
      // means the migration has not been applied to this environment.
      const firstError =
        channels.error || creatives.error || geos.error || funnel.error || delivery.error;
      if (firstError) throw firstError;

      return {
        channels: (channels.data ?? []) as unknown as ChannelRow[],
        creatives: (creatives.data ?? []) as unknown as CreativeRow[],
        geos: (geos.data ?? []) as unknown as GeoRow[],
        funnel: (funnel.data ?? []) as unknown as FunnelRow[],
        delivery: (delivery.data ?? []) as unknown as DeliveryRow[],
      };
    },
  });
}

export default function MetaAttributionPanel() {
  const { data, isLoading, error } = useAttribution();

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading attribution…</p>;
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Attribution views unavailable</AlertTitle>
        <AlertDescription className="text-xs">
          {(error as Error).message}. If this says the relation does not exist, the tracking
          migrations have not been applied to this database yet.
        </AlertDescription>
      </Alert>
    );
  }

  const channels = data?.channels ?? [];
  const creatives = data?.creatives ?? [];
  const geos = data?.geos ?? [];
  const funnel = data?.funnel ?? [];
  const delivery = data?.delivery ?? [];

  const attributedBookings = channels
    .filter((c) => c.channel !== "(direct/organic)")
    .reduce((s, c) => s + Number(c.paid_bookings ?? 0), 0);
  const attributedRevenue = channels
    .filter((c) => c.channel !== "(direct/organic)")
    .reduce((s, c) => s + Number(c.contract_revenue ?? 0), 0);
  const totalBookings = channels.reduce((s, c) => s + Number(c.paid_bookings ?? 0), 0);

  const funnel30 = funnel.reduce(
    (acc, d) => ({
      landing: acc.landing + Number(d.book_landing_views ?? 0),
      started: acc.started + Number(d.booking_started ?? 0),
      leads: acc.leads + Number(d.leads ?? 0),
      created: acc.created + Number(d.bookings_created ?? 0),
      checkout: acc.checkout + Number(d.checkouts_started ?? 0),
      paid: acc.paid + Number(d.deposits_paid ?? 0),
    }),
    { landing: 0, started: 0, leads: 0, created: 0, checkout: 0, paid: 0 },
  );

  const failedSends = delivery
    .filter((d) => d.status === "error")
    .reduce((s, d) => s + Number(d.events ?? 0), 0);
  const skippedSends = delivery
    .filter((d) => d.status === "skipped_no_secrets")
    .reduce((s, d) => s + Number(d.events ?? 0), 0);
  const sentEvents = delivery
    .filter((d) => d.status === "sent")
    .reduce((s, d) => s + Number(d.events ?? 0), 0);

  return (
    <div className="space-y-6">
      {/* --- configuration state ------------------------------------------ */}
      {!META_PIXEL_ID && (
        <Alert>
          <Radio className="h-4 w-4" />
          <AlertTitle>Meta Pixel is not configured yet</AlertTitle>
          <AlertDescription className="text-xs">
            The tracking pipeline is installed and recording first-party data, but nothing is
            being sent to Meta. Add the Dataset id to <code>src/lib/tracking/config.ts</code> and
            the <code>META_PIXEL_ID</code> / <code>META_CAPI_TOKEN</code> secrets in Lovable
            Cloud. Step-by-step: <code>docs/META-PIXEL-CAPI-SETUP.md</code>.
          </AlertDescription>
        </Alert>
      )}

      {skippedSends > 0 && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{skippedSends} conversions recorded but not sent to Meta</AlertTitle>
          <AlertDescription className="text-xs">
            These are journaled with status <code>skipped_no_secrets</code>: the server secrets
            are missing. Real bookings happened; Meta just does not know about them.
          </AlertDescription>
        </Alert>
      )}

      {failedSends > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{failedSends} conversions failed to reach Meta</AlertTitle>
          <AlertDescription className="text-xs">
            Check the <code>error</code> column in <code>meta_event_delivery</code>. While these
            are missing, the campaign is optimizing on incomplete data.
          </AlertDescription>
        </Alert>
      )}

      {/* --- headline numbers ---------------------------------------------- */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Ad-attributed bookings</CardTitle>
            <Megaphone className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{attributedBookings}</div>
            <p className="text-xs text-muted-foreground">
              of {totalBookings} paid bookings all time
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Ad-attributed revenue</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{money(attributedRevenue)}</div>
            <p className="text-xs text-muted-foreground">
              Contract value. Compare against spend in Ads Manager.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Book page → deposit</CardTitle>
            <MousePointerClick className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {funnel30.landing > 0
                ? `${((funnel30.paid / funnel30.landing) * 100).toFixed(1)}%`
                : "—"}
            </div>
            <p className="text-xs text-muted-foreground">Last 30 days on record</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Events sent to Meta</CardTitle>
            <Radio className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{sentEvents}</div>
            <p className="text-xs text-muted-foreground">
              {failedSends} failed · {skippedSends} skipped
            </p>
          </CardContent>
        </Card>
      </div>

      {/* --- funnel --------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Funnel — last 30 days on record</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            {[
              ["/book viewed", funnel30.landing],
              ["Started", funnel30.started],
              ["Leads", funnel30.leads],
              ["Booking created", funnel30.created],
              ["Checkout", funnel30.checkout],
              ["Deposit paid", funnel30.paid],
            ].map(([label, value]) => (
              <div key={label as string} className="rounded-lg border p-3">
                <div className="text-xl font-bold">{value as number}</div>
                <div className="text-xs text-muted-foreground">{label as string}</div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            These counts come from the first-party ledger, not from Meta, so they stay complete
            even when a Meta send is skipped.
          </p>
        </CardContent>
      </Card>

      {/* --- channel -------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Where paid bookings came from</CardTitle>
        </CardHeader>
        <CardContent>
          {channels.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No paid bookings recorded yet with attribution data.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Channel</TableHead>
                  <TableHead>Campaign</TableHead>
                  <TableHead className="text-right">Bookings</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">Avg value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {channels.map((c, i) => (
                  <TableRow key={`${c.channel}-${c.campaign}-${i}`}>
                    <TableCell className="font-medium">{c.channel}</TableCell>
                    <TableCell className="text-muted-foreground">{c.campaign}</TableCell>
                    <TableCell className="text-right">{c.paid_bookings}</TableCell>
                    <TableCell className="text-right">{money(c.contract_revenue)}</TableCell>
                    <TableCell className="text-right">{money(c.avg_contract_value)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* --- creative + geo -------------------------------------------------- */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">By creative (utm_content)</CardTitle>
          </CardHeader>
          <CardContent>
            {creatives.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Creative</TableHead>
                    <TableHead className="text-right">Bookings</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {creatives.map((c, i) => (
                    <TableRow key={`${c.creative}-${i}`}>
                      <TableCell>
                        <div className="font-medium">{c.creative}</div>
                        {c.meta_ad_id && (
                          <Badge variant="outline" className="mt-1 text-[10px]">
                            ad {c.meta_ad_id}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">{c.paid_bookings}</TableCell>
                      <TableCell className="text-right">{money(c.contract_revenue)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">By ad set / GEO (utm_term)</CardTitle>
          </CardHeader>
          <CardContent>
            {geos.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ad set</TableHead>
                    <TableHead className="text-right">Bookings</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {geos.map((g, i) => (
                    <TableRow key={`${g.geo_adset}-${i}`}>
                      <TableCell>
                        <div className="font-medium">{g.geo_adset}</div>
                        {g.meta_adset_id && (
                          <Badge variant="outline" className="mt-1 text-[10px]">
                            adset {g.meta_adset_id}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">{g.paid_bookings}</TableCell>
                      <TableCell className="text-right">{money(g.contract_revenue)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* --- delivery log ---------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Meta delivery log</CardTitle>
        </CardHeader>
        <CardContent>
          {delivery.length === 0 ? (
            <p className="text-sm text-muted-foreground">No events sent yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Day</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Count</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {delivery.slice(0, 30).map((d, i) => (
                  <TableRow key={`${d.day}-${d.event_name}-${d.status}-${i}`}>
                    <TableCell>{format(parseISO(d.day), "MMM d")}</TableCell>
                    <TableCell>{d.event_name}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          d.status === "sent"
                            ? "default"
                            : d.status === "error"
                              ? "destructive"
                              : "secondary"
                        }
                      >
                        {d.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{d.events}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
