-- Atomic claim for recurring invoices.
--
-- process-scheduled-jobs style race: the cron runs at 19:00 and 20:00 UTC. The
-- old flow read the due parents, inserted a child, called create-invoice, and
-- only then bumped recurring_next_send_at. If create-invoice failed (Stripe or
-- SMTP timeout) the bump never happened, so an hour later the same parent was
-- still "due" and produced a SECOND child — two invoices for the same period
-- reaching the customer. Two concurrent runs could double up the same way.
--
-- claim_recurring_invoice moves the schedule forward FIRST, conditional on the
-- value the caller read. Exactly one caller can win that update; everyone else
-- gets false and skips. Same DST-safe math as bump_recurring_next_send: always
-- land on 3 PM America/New_York regardless of the EST/EDT transition.

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
    AND recurring_next_send_at = p_expected_next_send;

  GET DIAGNOSTICS v_claimed = ROW_COUNT;
  RETURN v_claimed = 1;
END;
$$;
