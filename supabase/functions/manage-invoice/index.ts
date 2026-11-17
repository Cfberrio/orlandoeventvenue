// E-8 / E-9 (ClickUp 86e40ach2): void, offline mark-paid and resend for
// standalone invoices; void for add-on invoices. Admin only.
//
// Order matters: the Stripe Checkout session is closed BEFORE the row changes.
// If Stripe cannot confirm the session is closed, nothing is changed and the
// office is told, because a voided invoice with a live link can still be paid.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { authorizeAdminOrService, supabaseAdminAuthDeps } from "../_shared/admin-auth.ts";
import {
  refuseAction,
  sessionMustBeClosed,
  stopsRecurring,
  type ActionRequest,
  type InvoiceAction,
  type InvoiceKind,
} from "../_shared/invoice-actions.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const auth = await authorizeAdminOrService(req.headers.get("Authorization"), serviceKey, supabaseAdminAuthDeps(supabase));
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    const actorId = auth.via === "admin" ? auth.userId : null;

    const body = await req.json().catch(() => ({}));
    const action = body.action as InvoiceAction;
    const kind = body.kind as InvoiceKind;
    const id = String(body.id ?? "");
    if (!["void", "mark_paid", "resend"].includes(action) || !["invoice", "addon"].includes(kind) || !id) {
      return json({ error: "action (void|mark_paid|resend), kind (invoice|addon) and id are required" }, 400);
    }
    const request: ActionRequest = {
      action,
      kind,
      reason: body.reason ?? null,
      method: body.method ?? null,
      reference: body.reference ?? null,
    };

    const table = kind === "invoice" ? "invoices" : "booking_addon_invoices";
    const { data: row, error: readError } = await supabase.from(table).select("*").eq("id", id).maybeSingle();
    if (readError) return json({ error: `Could not read the invoice: ${readError.message}` }, 500);
    if (!row) return json({ error: "Invoice not found" }, 404);

    const refusal = refuseAction(row, request);
    if (refusal) return json({ error: refusal }, 409);

    // Claim the row so two actions on the same invoice cannot overlap. A claim
    // older than 2 minutes is treated as abandoned.
    const staleBefore = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const { data: claimed, error: claimError } = await supabase
      .from(table)
      .update({ admin_action_claimed_at: new Date().toISOString() })
      .eq("id", id)
      .is("paid_at", null)
      .not("payment_status", "in", "(paid,void)")
      .or(`admin_action_claimed_at.is.null,admin_action_claimed_at.lt.${staleBefore}`)
      .select("id, stripe_session_id");
    if (claimError) return json({ error: `Could not lock the invoice: ${claimError.message}` }, 500);
    if (!claimed?.length) return json({ error: "Another change to this invoice is in progress, or it was just paid. Reload the page." }, 409);
    // The session to close is the one on the row now, not the one first read.
    row.stripe_session_id = claimed[0].stripe_session_id;
    const release = async () => {
      const { error } = await supabase.from(table).update({ admin_action_claimed_at: null }).eq("id", id);
      if (error) console.error("[manage-invoice] claim not released", error);
    };
    try {

    // 1. Close the Stripe link first.
    let sessionResult = "none";
    if (row.stripe_session_id) {
      const stripeKey = Deno.env.get("Stripe_Secret_Key");
      if (!stripeKey) return json({ error: "Stripe is not configured; nothing was changed" }, 500);
      const stripe = new Stripe(stripeKey, { apiVersion: "2023-10-16" });
      try {
        const session = await stripe.checkout.sessions.retrieve(row.stripe_session_id);
        if (session.payment_status === "paid" || session.status === "complete") {
          return json({ error: "Stripe shows this link as paid; wait for the payment to post instead of changing the invoice." }, 409);
        }
        if (sessionMustBeClosed(session.status)) {
          await stripe.checkout.sessions.expire(row.stripe_session_id);
          sessionResult = "expired";
        } else {
          sessionResult = session.status ?? "closed";
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // An expire can race a checkout that just completed: report, change nothing.
        return json({ error: `Could not close the Stripe link (${msg}); nothing was changed. Try again.` }, 502);
      }
    }

    const now = new Date().toISOString();

    // 2. Record the change, only if the invoice is still unpaid.
    if (action === "void") {
      const patch: Record<string, unknown> = {
        payment_status: "void",
        payment_url: null,
        voided_at: now,
        voided_by: actorId,
        void_reason: String(request.reason).trim(),
      };
      if (kind === "invoice" && stopsRecurring(row)) patch.recurring_active = false;
      const { data: updated, error } = await supabase
        .from(table).update(patch).eq("id", id).is("paid_at", null).neq("payment_status", "paid").select("id");
      if (error) return json({ error: `Stripe link closed but the void was not saved: ${error.message}` }, 500);
      if (!updated?.length) return json({ error: "The invoice was paid while voiding; reload the page." }, 409);
      if (kind === "addon" && row.booking_id) {
        const { error: evError } = await supabase.from("booking_events").insert({
          booking_id: row.booking_id,
          event_type: "addon_invoice_voided",
          channel: "admin",
          metadata: { addon_invoice_id: id, amount: row.total_amount, reason: patch.void_reason, recorded_by: actorId, stripe_session: sessionResult },
        });
        if (evError) console.error("[manage-invoice] booking event not recorded", evError);
      }
      return json({ ok: true, action, id, stripe_session: sessionResult, recurring_stopped: patch.recurring_active === false });
    }

    if (action === "mark_paid") {
      const { data: updated, error } = await supabase
        .from("invoices")
        .update({
          payment_status: "paid",
          paid_at: now,
          payment_url: null,
          paid_offline_method: request.method,
          paid_offline_reference: String(request.reference).trim(),
        })
        .eq("id", id).is("paid_at", null).neq("payment_status", "void").select("id");
      if (error) return json({ error: `Stripe link closed but the payment was not saved: ${error.message}` }, 500);
      if (!updated?.length) return json({ error: "The invoice changed meanwhile; reload the page." }, 409);
      return json({ ok: true, action, id, stripe_session: sessionResult });
    }

    // resend: the old link is closed; create-invoice issues a new link and emails it.
    const res = await fetch(`${supabaseUrl}/functions/v1/create-invoice`, {
      method: "POST",
      headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ invoice_id: id }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) {
      return json({ error: `Old link closed, but a new one could not be created: ${out.error ?? res.status}. Use Resend again.` }, 502);
    }
    return json({ ok: true, action, id, stripe_session: sessionResult, email_sent: out.email_sent === true, payment_url: out.payment_url });
    } finally {
      await release();
    }
  } catch (e) {
    console.error("[manage-invoice]", e);
    return json({ error: e instanceof Error ? e.message : "Internal error" }, 500);
  }
});
