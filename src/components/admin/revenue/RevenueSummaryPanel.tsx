import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CreditCard, DollarSign, Globe, Receipt, XCircle } from "lucide-react";
import type { RevenueSummary } from "@/hooks/useRevenueData";
import { money } from "@/lib/reportMoney";

interface Props {
  summary: RevenueSummary | null;
  isLoading: boolean;
  error: string | null;
}

// ClickUp 86e40ach2 R2-1/R2-2/R2-3/R2-5/R2-6: one headline on one basis.
// Collected (net) + Card fees = Gross, which is what Stripe charged (plus any
// offline payment recorded in the system). Externals and cancelled bookings
// without a refund decision are shown apart and never added in.
export default function RevenueSummaryPanel({ summary, isLoading, error }: Props) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <Skeleton className="h-4 w-24" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-32" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (error || !summary) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-destructive">{error ?? "No totals for this range"}</p>
        </CardContent>
      </Card>
    );
  }

  const s = summary;
  const parts = [
    `Bookings ${money(s.booking_revenue)} (${s.booking_count})`,
    `Invoices ${money(s.invoice_revenue)} (${s.invoice_count})`,
  ];
  if (Number(s.cancelled_kept_revenue) !== 0) {
    parts.push(`Kept on cancelled ${money(s.cancelled_kept_revenue)} (${s.cancelled_kept_count})`);
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Collected (net)</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{money(s.collected_net)}</div>
            <p className="text-xs text-muted-foreground mt-1">{parts.join(" · ")}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Card fees (paid by guests)</CardTitle>
            <CreditCard className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{money(s.card_fees)}</div>
            <p className="text-xs text-muted-foreground mt-1">On deposits, balances, add-ons and invoices</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Gross charged</CardTitle>
            <Receipt className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{money(s.collected_gross)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Net + card fees · {s.payment_days} day{Number(s.payment_days) === 1 ? "" : "s"} with payments
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="border-dashed">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">External (paid on platform)</CardTitle>
            <Globe className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-semibold">{money(s.external_amount)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {s.external_count} external booking{Number(s.external_count) === 1 ? "" : "s"} (Peerspace, etc.). Not in
              Collected: the platform took the payment.
            </p>
          </CardContent>
        </Card>

        <Card className="border-dashed">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Cancelled — refund not recorded</CardTitle>
            <XCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-semibold">{money(s.cancelled_unrecorded_amount)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Charged on {s.cancelled_unrecorded_count} cancelled booking
              {Number(s.cancelled_unrecorded_count) === 1 ? "" : "s"}. Not in Collected until the refund decision is
              recorded on the booking.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
