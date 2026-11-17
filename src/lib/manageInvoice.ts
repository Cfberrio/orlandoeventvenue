// E-8 / E-9 (86e40ach2): office actions on invoices through manage-invoice.

export type InvoiceKind = "invoice" | "addon";
export type InvoiceAction = "void" | "mark_paid" | "resend";

export const OFFLINE_METHOD_OPTIONS: { value: string; label: string }[] = [
  { value: "zelle", label: "Zelle" },
  { value: "cash", label: "Cash" },
  { value: "check", label: "Check" },
  { value: "card_in_person", label: "Card in person" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "other", label: "Other" },
];

export interface ManageInvoicePayload {
  action: InvoiceAction;
  kind: InvoiceKind;
  id: string;
  reason?: string;
  method?: string;
  reference?: string;
}

export interface ManageInvoiceResult {
  ok: boolean;
  error?: string;
  email_sent?: boolean;
  recurring_stopped?: boolean;
}

interface InvokeClient {
  functions: {
    invoke: (name: string, options: { body: unknown }) => Promise<{ data: unknown; error: unknown }>;
  };
}

/** Client-side check so the dialog explains what is missing before calling. */
export function validateInvoiceAction(p: ManageInvoicePayload): string | null {
  if (p.action === "void" && !(p.reason ?? "").trim()) return "Say why the invoice is being voided.";
  if (p.action === "mark_paid") {
    if (!OFFLINE_METHOD_OPTIONS.some((o) => o.value === p.method)) return "Choose how it was paid.";
    if (!(p.reference ?? "").trim()) return "Add the payment reference (receipt, Zelle confirmation, check #).";
  }
  return null;
}

/** Calls manage-invoice; non-2xx bodies are returned as { ok:false, error }. */
export async function manageInvoice(client: InvokeClient, payload: ManageInvoicePayload): Promise<ManageInvoiceResult> {
  const { data, error } = await client.functions.invoke("manage-invoice", { body: payload });
  if (!error) {
    const d = (data ?? {}) as ManageInvoiceResult;
    return { ...d, ok: d.ok === true };
  }
  const context = (error as { context?: unknown }).context;
  if (context && typeof (context as Response).json === "function") {
    const body = await (context as Response).json().catch(() => null);
    if (body && typeof body === "object") return { ok: false, error: (body as { error?: string }).error ?? "Request failed" };
  }
  return { ok: false, error: error instanceof Error ? error.message : String(error) };
}
