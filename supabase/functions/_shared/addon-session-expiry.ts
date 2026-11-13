// M-9 (ClickUp 86e40ach2): close the Stripe Checkout sessions of a booking's
// unpaid add-on invoices when the booking is cancelled.
//
// Kept free of Deno/Stripe imports so the edge tests can drive it with fakes.

export interface AddonSessionRow {
  id: string;
  stripe_session_id: string | null;
}

export interface CheckoutSessionApi {
  retrieve(id: string): Promise<{ status?: string | null }>;
  expire(id: string): Promise<unknown>;
}

export interface AddonExpiryResult {
  checked: number;
  expired: string[];
  already_closed: string[];
  failed: Array<{ invoice_id: string; session_id: string; error: string }>;
}

export async function expireAddonSessionsWith(
  rows: AddonSessionRow[],
  sessions: CheckoutSessionApi | null,
): Promise<AddonExpiryResult> {
  const result: AddonExpiryResult = { checked: 0, expired: [], already_closed: [], failed: [] };
  const seen = new Set<string>();
  for (const row of rows) {
    const sessionId = row.stripe_session_id;
    if (!sessionId || seen.has(sessionId)) continue;
    seen.add(sessionId);
    result.checked++;
    if (!sessions) {
      result.failed.push({ invoice_id: row.id, session_id: sessionId, error: "stripe_not_configured" });
      continue;
    }
    try {
      const session = await sessions.retrieve(sessionId);
      if (session.status === "open") {
        await sessions.expire(sessionId);
        result.expired.push(sessionId);
      } else {
        result.already_closed.push(sessionId);
      }
    } catch (e) {
      result.failed.push({
        invoice_id: row.id,
        session_id: sessionId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return result;
}
