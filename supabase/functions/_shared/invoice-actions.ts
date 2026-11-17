// E-8 / E-9 (ClickUp 86e40ach2): what the office may do with an invoice.
// Pure: no Deno/Stripe imports, so the edge tests drive it directly.

export type InvoiceKind = "invoice" | "addon";
export type InvoiceAction = "void" | "mark_paid" | "resend";

export const OFFLINE_METHODS = ["cash", "zelle", "check", "card_in_person", "bank_transfer", "other"] as const;
export type OfflineMethod = (typeof OFFLINE_METHODS)[number];

export interface InvoiceRowLike {
  payment_status: string | null;
  paid_at: string | null;
  stripe_session_id?: string | null;
  is_recurring?: boolean | null;
  recurring_parent_id?: string | null;
  recurring_template_only?: boolean | null;
}

export interface ActionRequest {
  action: InvoiceAction;
  kind: InvoiceKind;
  reason?: string | null;
  method?: string | null;
  reference?: string | null;
}

/** Null when allowed, otherwise the reason it is refused (shown to the office). */
export function refuseAction(row: InvoiceRowLike, req: ActionRequest): string | null {
  if (row.paid_at || row.payment_status === "paid") return "This invoice is already paid.";
  if (row.payment_status === "void") return "This invoice is already void.";
  if (req.kind === "addon" && req.action !== "void") {
    return "Add-on invoices can only be voided here; record an offline add-on payment on the booking.";
  }
  if (req.action === "void" && !(req.reason ?? "").trim()) return "Say why the invoice is being voided.";
  if (req.action === "mark_paid") {
    if (!OFFLINE_METHODS.includes((req.method ?? "") as OfflineMethod)) return "Choose how it was paid.";
    if (!(req.reference ?? "").trim()) return "Add the payment reference (receipt, Zelle confirmation, check #).";
  }
  if (req.action === "resend" && row.recurring_template_only) {
    return "This is a recurring schedule, not a bill; it has nothing to resend.";
  }
  return null;
}

/** A recurring parent stops issuing children when it is voided. */
export function stopsRecurring(row: InvoiceRowLike): boolean {
  return Boolean(row.is_recurring) && !row.recurring_parent_id;
}

/**
 * The Stripe session must be closed before the row changes, or the old link
 * stays payable. "open" sessions are expired; anything else is already closed.
 */
export function sessionMustBeClosed(status: string | null | undefined): boolean {
  return status === "open";
}
