import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Package } from "lucide-react";
import { getVisibleAddons, type AddonSource } from "@/lib/bookingAddons";

export default function StaffAddonsPanel({ booking }: { booking: AddonSource }) {
  const items = getVisibleAddons(booking);
  if (items.length === 0) return null;

  return (
    <Card className="border-l-4 border-l-emerald-500 bg-emerald-500/5">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Package className="h-5 w-5" />
          <span>Add-ons del cliente</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {items.map((item, index) => (
            <li key={`${item.key}-${index}`} className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium">{item.label}</span>
              {item.detail && <Badge variant="secondary">{item.detail}</Badge>}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
