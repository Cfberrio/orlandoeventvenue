export interface AddonItem {
  key: string;
  label: string;
  detail?: string;
}

interface AddonDetailEntry {
  type?: string;
  quantity?: number;
  amount?: number;
}

export interface AddonSource {
  tablecloths?: boolean | null;
  tablecloth_quantity?: number | null;
  setup_breakdown?: boolean | null;
  package?: string | null;
  package_start_time?: string | null;
  package_end_time?: string | null;
  bar_package?: string | null;
  bar_package_label?: string | null;
  addons_detail?: AddonDetailEntry[] | null;
}

const hhmm = (t?: string | null) => (t ? t.slice(0, 5) : "");
const hasPackage = (p?: string | null) => !!p && p !== "none";

// addons_detail entry types already represented by a typed column (exact match, normalized).
const COVERED_TYPES = new Set(["tablecloth", "tablecloths", "setup", "setup_breakdown", "package", "bar", "bar_package"]);

export function getVisibleAddons(booking: AddonSource): AddonItem[] {
  const items: AddonItem[] = [];

  if (booking.tablecloths || (booking.tablecloth_quantity ?? 0) > 0) {
    items.push({ key: "tablecloths", label: "Manteles", detail: String(booking.tablecloth_quantity ?? 0) });
  }

  if (booking.setup_breakdown) {
    items.push({ key: "setup_breakdown", label: "Montaje y desmontaje" });
  }

  if (hasPackage(booking.package)) {
    const hours =
      booking.package_start_time && booking.package_end_time
        ? ` (${hhmm(booking.package_start_time)} - ${hhmm(booking.package_end_time)})`
        : "";
    items.push({ key: "package", label: "Paquete AV", detail: `${booking.package}${hours}` });
  }

  if (booking.bar_package && booking.bar_package !== "none" && booking.bar_package.trim() !== "") {
    items.push({ key: "bar_package", label: "Bar", detail: booking.bar_package_label ?? booking.bar_package });
  }

  for (const extra of booking.addons_detail ?? []) {
    const type = (extra.type ?? "").trim();
    if (!type) continue;
    if (COVERED_TYPES.has(type.toLowerCase())) continue;
    items.push({ key: `addon-${type}`, label: type, detail: extra.quantity != null ? String(extra.quantity) : undefined });
  }

  return items;
}
