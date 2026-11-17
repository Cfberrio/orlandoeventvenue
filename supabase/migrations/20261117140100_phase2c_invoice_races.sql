-- Phase 2C fixes (ClickUp 86e40ach2, Codex review of manage-invoice).
--
-- 1. admin_action_claimed_at: manage-invoice claims the row atomically before
--    acting, so void / mark-paid / resend on the same invoice cannot overlap.
-- 2. persist_invoice_session: create-invoice stores a new Stripe session only
--    if the invoice is still unpaid, not void, still on the session it started
--    from, and (for a recurring child) its parent is still active. The parent
--    row is locked, so voiding a parent and issuing a child serialize. When it
--    returns false the caller expires the new session and sends no email.

ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS admin_action_claimed_at timestamptz;
ALTER TABLE public.booking_addon_invoices ADD COLUMN IF NOT EXISTS admin_action_claimed_at timestamptz;

CREATE OR REPLACE FUNCTION public.persist_invoice_session(
  p_invoice_id uuid,
  p_expected_session text,
  p_session_id text,
  p_url text,
  p_fee_pct numeric,
  p_fee numeric,
  p_total numeric
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_inv public.invoices%ROWTYPE;
  v_parent public.invoices%ROWTYPE;
BEGIN
  PERFORM public._assert_admin_or_service();
  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF v_inv.recurring_parent_id IS NOT NULL THEN
    SELECT * INTO v_parent FROM public.invoices WHERE id = v_inv.recurring_parent_id FOR UPDATE;
    IF NOT FOUND OR NOT COALESCE(v_parent.recurring_active, false) OR v_parent.payment_status = 'void' THEN
      RETURN false;
    END IF;
  END IF;
  IF v_inv.paid_at IS NOT NULL OR v_inv.payment_status NOT IN ('pending', 'expired')
     OR v_inv.stripe_session_id IS DISTINCT FROM p_expected_session THEN
    RETURN false;
  END IF;
  UPDATE public.invoices SET
    payment_url = p_url,
    stripe_session_id = p_session_id,
    payment_status = 'pending',
    processing_fee_pct = p_fee_pct,
    processing_fee = p_fee,
    total_charged = p_total,
    updated_at = now()
  WHERE id = p_invoice_id;
  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.persist_invoice_session(uuid, text, text, text, numeric, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_invoice_session(uuid, text, text, text, numeric, numeric, numeric) TO service_role;
