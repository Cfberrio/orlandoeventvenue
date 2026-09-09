-- Harden the recurring-invoice claim.
--
-- 1. recurring_interval_days guard. The claim is now the ONLY defence against
--    duplicate recurring invoices, and it did not validate the interval. With
--    interval_days = 0 the UPDATE leaves recurring_next_send_at unchanged yet
--    still reports ROW_COUNT = 1, so the claim "succeeds", the row stays due,
--    and every later cron run bills the customer again — indefinitely. With
--    interval_days = NULL the new value is NULL and the recurring schedule dies
--    silently. Both are now refused, so the row is skipped and stays visible as
--    due instead of being charged twice.
--
-- 2. EXECUTE privileges. SECURITY DEFINER functions are granted to PUBLIC by
--    default, so anyone holding the anon key could skip a billing period given
--    the invoice uuid and its exact timestamp. Only the service role (the cron)
--    needs to call these.

CREATE OR REPLACE FUNCTION public.claim_recurring_invoice(
  p_invoice_id uuid,
  p_expected_next_send timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claimed int;
BEGIN
  UPDATE public.invoices
  SET recurring_next_send_at = (
    (recurring_next_send_at AT TIME ZONE 'America/New_York')::date
      + (recurring_interval_days * interval '1 day')
      + interval '15 hours'
  ) AT TIME ZONE 'America/New_York'
  WHERE id = p_invoice_id
    AND recurring_active = true
    AND recurring_interval_days >= 1
    AND recurring_next_send_at = p_expected_next_send;

  GET DIAGNOSTICS v_claimed = ROW_COUNT;
  RETURN v_claimed = 1;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_recurring_invoice(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_recurring_invoice(uuid, timestamptz) TO service_role;

-- Same exposure, carried since March. No application code calls it any more.
REVOKE EXECUTE ON FUNCTION public.bump_recurring_next_send(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bump_recurring_next_send(uuid) TO service_role;
