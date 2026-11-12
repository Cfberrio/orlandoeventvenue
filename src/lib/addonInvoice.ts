// Shared helpers for booking add-on invoices (booking_addon_invoices).
// One place for the item labels so the Add-On Invoices list, the Services
// card and the Payment Summary describe the same invoice the same way.

export interface AddonInvoiceLike {
  package?: string | null;
  package_start_time?: string | null;
  package_end_time?: string | null;
  setup_breakdown?: boolean | null;
  tablecloths?: boolean | null;
  tablecloth_quantity?: number | null;
  bar_package?: string | null;
  bar_package_label?: string | null;
  bar_guest_count?: number | null;
  total_amount?: number | string | null;
  payment_status?: string | null;
}

const PACKAGE_LABELS: Record<string, string> = {
  none: "Services Only",
  basic: "Basic Package",
  led: "LED Package",
  workshop: "Workshop Package",
};

export function addonInvoiceItemLabels(invoice: AddonInvoiceLike): string[] {
  const items: string[] = [];
  const pkg = invoice.package ?? "none";
  if (pkg !== "none") {
    const label = PACKAGE_LABELS[pkg] || pkg;
    if (invoice.package_start_time && invoice.package_end_time) {
      const start = new Date(`2000-01-01T${invoice.package_start_time}`);
      const end = new Date(`2000-01-01T${invoice.package_end_time}`);
      const hours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
      items.push(hours > 0 ? `${label} (${hours}h)` : label);
    } else {
      items.push(label);
    }
  }
  if (invoice.setup_breakdown) items.push("Setup & Breakdown");
  if (invoice.tablecloths) items.push(`Tablecloths (${invoice.tablecloth_quantity ?? 0})`);
  if (invoice.bar_package && invoice.bar_package !== "none") {
    const barLabel = invoice.bar_package_label || invoice.bar_package;
    items.push(
      invoice.bar_guest_count ? `Bar: ${barLabel} (${invoice.bar_guest_count} guests)` : `Bar: ${barLabel}`
    );
  }
  return items;
}

export function paidAddonInvoices<T extends AddonInvoiceLike>(invoices: T[] | null | undefined): T[] {
  return (invoices ?? []).filter((inv) => inv.payment_status === "paid");
}

/** Sum of paid add-on invoices, before processing fees (same basis as bookings.total_amount). */
export function paidAddonTotal(invoices: AddonInvoiceLike[] | null | undefined): number {
  return paidAddonInvoices(invoices).reduce((sum, inv) => sum + Number(inv.total_amount ?? 0), 0);
}
