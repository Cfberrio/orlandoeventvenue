import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Package } from "lucide-react";
import { getVisibleAddons, type AddonItem, type AddonSource } from "@/lib/bookingAddons";
import { useStaffPaidAddons } from "@/hooks/useStaffData";

function AddonList({ items }: { items: AddonItem[] }) {
  return (
    <ul className="space-y-2">
      {items.map((item, index) => (
        <li key={`${item.key}-${index}`} className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium">{item.label}</span>
          {item.detail && <Badge variant="secondary">{item.detail}</Badge>}
        </li>
      ))}
    </ul>
  );
}

export default function StaffAddonsPanel({ booking, bookingId }: { booking: AddonSource; bookingId?: string }) {
  const items = getVisibleAddons(booking);
  // E-1: add-ons billed after booking and already paid. The booking row keeps
  // its original services, so these come from the paid add-on invoices.
  const { data: paidAddons } = useStaffPaidAddons(bookingId);
  const laterItems = (paidAddons ?? []).flatMap((addon) => getVisibleAddons(addon));

  if (items.length === 0 && laterItems.length === 0) return null;

  return (
    <Card className="border-l-4 border-l-emerald-500 bg-emerald-500/5">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Package className="h-5 w-5" />
          <span>Client add-ons</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {items.length > 0 && <AddonList items={items} />}
        {laterItems.length > 0 && (
          <div className={items.length > 0 ? "pt-4 border-t border-border space-y-2" : "space-y-2"}>
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Added after booking (paid)</p>
            <AddonList items={laterItems} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
