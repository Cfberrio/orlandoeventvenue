-- Monthly recurring invoices on a fixed day of the month.
--
-- Until now "Monthly" stored recurring_interval_days = 30 and the claim added 30
-- days per period, so the send date drifted (FCG Church Lease: Jul 3 → Aug 3 →
-- Oct 1 → Oct 31) and nobody could pick the day. A monthly invoice now carries
-- recurring_day_of_month and the claim moves it to that day of the following
-- month, at 3 PM America/New_York.
--
--   recurring_day_of_month  1–31, NULL = interval schedule (weekly, bi-weekly,
--                           custom, and legacy 30-day rows nobody converted).
--                           31 means "last day of month": every day is clamped
--                           to the month's last day, so no month is skipped.
--   recurring_last_sent_at  when the last period was claimed. Anchors the
--                           "at most one invoice per calendar month" rule when
--                           an admin moves the day, and is written in the same
--                           UPDATE as the claim so the two cannot interleave.
--   recurring_template_only true when the parent was created with "Wait until
--                           the chosen day": it was never sent and only serves
--                           as the template the cron clones. Explicit, so a
--                           send-now parent whose first send failed (also
--                           pending with no payment_url) is never mistaken for
--                           one.
--
-- Monthly rows keep recurring_interval_days = 30: process-recurring-invoices
-- filters on it and needs no change.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS recurring_day_of_month smallint,
  ADD COLUMN IF NOT EXISTS recurring_last_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS recurring_template_only boolean NOT NULL DEFAULT false;

ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_recurring_day_of_month_check;
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_recurring_day_of_month_check
  CHECK (recurring_day_of_month IS NULL OR recurring_day_of_month BETWEEN 1 AND 31);

-- "Wait until the chosen day" only exists for monthly schedules.
ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_recurring_template_only_check;
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_recurring_template_only_check
  CHECK (NOT recurring_template_only OR recurring_day_of_month IS NOT NULL);

-- Backfill the last send for existing recurring parents: the newest child that
-- was not cancelled (a cancelled child never reached the customer), otherwise
-- the parent itself, which create-invoice sent when it was created.
UPDATE public.invoices p
SET recurring_last_sent_at = COALESCE(
  (
    SELECT max(c.created_at)
    FROM public.invoices c
    WHERE c.recurring_parent_id = p.id
      AND c.payment_status <> 'cancelled'
  ),
  p.created_at
)
WHERE p.is_recurring = true
  AND p.recurring_parent_id IS NULL
  AND p.recurring_last_sent_at IS NULL;

-- 3 PM America/New_York on p_day of the month that starts at p_month_start,
-- clamped to that month's last day.
CREATE OR REPLACE FUNCTION public.recurring_month_occurrence(
  p_month_start date,
  p_day integer
)
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT (
    (
      date_trunc('month', p_month_start)::date
      + (
          LEAST(
            p_day,
            EXTRACT(day FROM date_trunc('month', p_month_start) + interval '1 month - 1 day')::int
          ) - 1
        )
    )::timestamp + interval '15 hours'
  ) AT TIME ZONE 'America/New_York';
$$;

-- First monthly send strictly after now(), no earlier than the month after
-- p_last_sent (at most one invoice per calendar month). NULL p_last_sent = the
-- current month is still open. Mirrors nextMonthlySend in
-- src/lib/recurringSchedule.ts, which only previews.
CREATE OR REPLACE FUNCTION public.next_monthly_send(
  p_day integer,
  p_last_sent timestamptz
)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_month date;
  v_next timestamptz;
  v_guard int := 0;
BEGIN
  IF p_day IS NULL OR p_day < 1 OR p_day > 31 THEN
    RAISE EXCEPTION 'Send day must be between 1 and 31' USING ERRCODE = '22023';
  END IF;

  IF p_last_sent IS NOT NULL THEN
    v_month := (date_trunc('month', p_last_sent AT TIME ZONE 'America/New_York')
                + interval '1 month')::date;
  ELSE
    v_month := date_trunc('month', now() AT TIME ZONE 'America/New_York')::date;
  END IF;

  v_next := public.recurring_month_occurrence(v_month, p_day);
  WHILE v_next <= now() LOOP
    v_guard := v_guard + 1;
    IF v_guard > 1200 THEN
      RAISE EXCEPTION 'Could not compute the next send date';
    END IF;
    v_month := (v_month + interval '1 month')::date;
    v_next := public.recurring_month_occurrence(v_month, p_day);
  END LOOP;

  RETURN v_next;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.next_monthly_send(integer, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.next_monthly_send(integer, timestamptz)
  TO authenticated, service_role;

-- New monthly parents are scheduled by the database clock, not the browser:
-- the dialog's dates are a preview. Send-now parents count as sent now;
-- wait-until-day templates have not sent anything yet.
CREATE OR REPLACE FUNCTION public.invoices_schedule_monthly_parent()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.is_recurring
     AND NEW.recurring_parent_id IS NULL
     AND NEW.recurring_day_of_month IS NOT NULL THEN
    NEW.recurring_interval_days := 30;
    NEW.recurring_last_sent_at := CASE WHEN NEW.recurring_template_only THEN NULL ELSE now() END;
    NEW.recurring_next_send_at := public.next_monthly_send(
      NEW.recurring_day_of_month,
      NEW.recurring_last_sent_at
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS invoices_schedule_monthly_parent ON public.invoices;
CREATE TRIGGER invoices_schedule_monthly_parent
  BEFORE INSERT ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.invoices_schedule_monthly_parent();

-- Claim: same contract as before (one winner per period, conditional on the
-- value the caller read). The new next-send is always strictly in the future,
-- so the 20:00 UTC run can never claim the same row again after a cron outage:
--   monthly   its day in the month after the CURRENT Orlando month (the period
--             just sent is this month's, however late it went out).
--   interval  the first cadence-aligned date after today, not just +N days
--             (a weekly row overdue three weeks would otherwise stay due and
--             bill again on every run until it caught up).
-- Both stamp the last send.
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
  SET recurring_next_send_at = CASE
        WHEN recurring_day_of_month IS NOT NULL THEN
          public.recurring_month_occurrence(
            (date_trunc('month', now() AT TIME ZONE 'America/New_York')
              + interval '1 month')::date,
            recurring_day_of_month
          )
        ELSE (
          (recurring_next_send_at AT TIME ZONE 'America/New_York')::date
            + (
                GREATEST(
                  1,
                  floor(
                    (
                      (now() AT TIME ZONE 'America/New_York')::date
                      - (recurring_next_send_at AT TIME ZONE 'America/New_York')::date
                    )::numeric / recurring_interval_days
                  )::int + 1
                ) * recurring_interval_days
              ) * interval '1 day'
            + interval '15 hours'
        ) AT TIME ZONE 'America/New_York'
      END,
      recurring_last_sent_at = now()
  WHERE id = p_invoice_id
    AND recurring_active = true
    AND recurring_interval_days >= 1
    AND recurring_next_send_at = p_expected_next_send;

  GET DIAGNOSTICS v_claimed = ROW_COUNT;
  RETURN v_claimed = 1;
END;
$$;

-- 20260909150000 revoked PUBLIC only, but Supabase also grants anon and
-- authenticated explicitly, so both could still call the claim and skip a
-- customer's billing period. Revoke those grants too.
REVOKE EXECUTE ON FUNCTION public.claim_recurring_invoice(uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_recurring_invoice(uuid, timestamptz) TO service_role;

REVOKE EXECUTE ON FUNCTION public.bump_recurring_next_send(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bump_recurring_next_send(uuid) TO service_role;

-- Admin action: set (or change) the send day of an active recurring invoice.
-- Converts a legacy 30-day row to a calendar-day schedule. Only future sends
-- move; next_monthly_send keeps it to one invoice per calendar month.
--
-- Locks the parent row, so it serialises with claim_recurring_invoice: if the
-- cron already claimed this period, recurring_last_sent_at is current and the
-- new date lands in the following month; if this runs first, the cron's claim
-- no longer matches the next-send it read and skips.
CREATE OR REPLACE FUNCTION public.set_recurring_day_of_month(
  p_invoice_id uuid,
  p_day integer
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_last_sent timestamptz;
  v_next timestamptz;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can change a recurring invoice schedule'
      USING ERRCODE = '42501';
  END IF;

  SELECT recurring_last_sent_at
  INTO v_last_sent
  FROM public.invoices
  WHERE id = p_invoice_id
    AND is_recurring = true
    AND recurring_parent_id IS NULL
    AND recurring_active = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recurring invoice not found or no longer active'
      USING ERRCODE = 'P0002';
  END IF;

  v_next := public.next_monthly_send(p_day, v_last_sent);

  UPDATE public.invoices
  SET recurring_day_of_month = p_day,
      recurring_interval_days = 30,
      recurring_next_send_at = v_next
  WHERE id = p_invoice_id;

  RETURN v_next;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_recurring_day_of_month(uuid, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_recurring_day_of_month(uuid, integer) TO authenticated;
